---
slug: flink-rpc-architecture-pekko
title: "Inside Flink’s Control Plane: How Apache Pekko Powers the RPC Layer"
authors: [Arun]
tags: [flink, akka, pekko, distributed-systems, concurrency, rpc]
date: 2026-02-15
---


Flink's distributed components must communicate constantly. TaskManagers report task state changes to JobMaster. JobMaster requests slots from ResourceManager. Dispatchers serve REST API queries about job status. All these components access shared state, particularly the ExecutionGraph. Traditional multi-threading with locks would create race conditions, deadlocks, and unmaintainable code. Flink solves this by adopting the Actor Model through the Akka/Pekko framework. Each component processes all requests on a single thread through a FIFO mailbox. This design eliminates concurrency bugs by architecture, not by locks.

<!-- truncate -->

## The Problem: Distributed Components and Shared State

### Why Components Must Communicate

Flink's runtime consists of distributed components that exchange messages continuously. The table below shows the primary RPC interactions in a running Flink cluster.

| Caller | Callee | RPC Method | Purpose |
|--------|--------|------------|---------|
| TaskManager | JobMaster | `updateTaskExecutionState()` | Report task transitions (RUNNING → FINISHED) |
| TaskManager | JobMaster | `acknowledgeCheckpoint()` | Confirm checkpoint completion |
| TaskManager | ResourceManager | `requestSlot()` | Request compute resources |
| TaskManager | ResourceManager | `sendHeartbeat()` | Maintain liveness |
| JobMaster | TaskManager | `triggerCheckpoint()` | Initiate checkpoint on task |
| JobMaster | TaskManager | `cancelTask()` | Stop task execution |
| Dispatcher | JobMaster | `requestJobStatus()` | Query job state for REST API |
| REST API | Dispatcher | `getJobDetails()` | Serve user queries |
| REST API | Dispatcher | `getCheckpointDetails()` | Serve checkpoint metrics |

These interactions happen thousands of times per second in a production cluster. A single JobMaster coordinates with hundreds of TaskManagers. Each TaskManager runs dozens of tasks. Every task state change, checkpoint acknowledgment, and heartbeat flows through this RPC layer.

### The Shared State Challenge

The [ExecutionGraph](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/executiongraph/ExecutionGraph.java) sits at the center of JobMaster. It tracks the complete state of job execution: which tasks are running, which have finished, which checkpoints are in progress, and which resources are allocated. Multiple components access ExecutionGraph for different purposes.

TaskManagers update ExecutionGraph when they report state changes. A task transitions from DEPLOYING to RUNNING. Another task finishes and transitions to FINISHED. Each update modifies the graph's internal state.

The [CheckpointCoordinator](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/checkpoint/CheckpointCoordinator.java) reads ExecutionGraph to trigger checkpoints. It iterates through all execution vertices. It sends checkpoint barriers to each task. It tracks acknowledgments as they arrive.

The Dispatcher serves REST API queries. A user requests job status. The Dispatcher reads ExecutionGraph to return current state. Another user requests checkpoint details. The Dispatcher reads checkpoint metrics from the same graph.

### What Breaks Without Protection

Consider what happens if these operations execute concurrently without protection. Thread 1 iterates through ExecutionGraph vertices to trigger a checkpoint. Thread 2 updates a task's state, modifying the vertex collection. Thread 1's iterator becomes invalid. The JVM throws `ConcurrentModificationException`. The checkpoint fails.

The alternative is worse. Without an exception, Thread 1 reads partially updated state. It triggers checkpoints on some tasks but misses others. It sees a task as RUNNING when it has already FINISHED. The checkpoint completes with inconsistent state. Data corruption follows.

Traditional solutions require locks. Every method that reads ExecutionGraph acquires a read lock. Every method that writes acquires a write lock. The code becomes littered with `lock.readLock().lock()` and `lock.writeLock().lock()` calls. Developers must remember to release locks in finally blocks. They must avoid nested lock acquisitions that cause deadlocks. They must reason about every possible thread interleaving across hundreds of methods.

This approach does not scale. Lock contention becomes a performance bottleneck. Debugging deadlocks in production takes days. New engineers introduce subtle race conditions because they forgot to acquire a lock in one code path.

---

## The Solution: Actor Model via Akka/Pekko

Flink adopts the Actor Model to eliminate these concurrency challenges. The Actor Model, popularized by Erlang and implemented in Java by Akka (now Apache Pekko), provides a simple guarantee: each actor processes one message at a time on a single thread. This guarantee makes shared state access inherently thread-safe without locks.

### Core Mechanism: Single Thread Execution

The fundamental insight is simple. Instead of allowing multiple threads to access shared state concurrently, route all access through a single thread. Messages from different callers queue up in a mailbox. A single worker thread processes them one at a time in FIFO order. No two messages execute concurrently. No race conditions are possible.

![Concurrent Requests Flow](/img/blog/flink-rpc/fifo.svg)

**Multiple Threads → Single Actor.** When TaskManager reports a state change, it does not call JobMaster directly. It sends a message to JobMaster's actor. When CheckpointCoordinator triggers a checkpoint, it sends another message. When REST API queries job status, it sends yet another message. Three different callers. Three different threads. All messages arrive at the same actor.

**Actor Mailbox = FIFO Queue.** The actor maintains an internal mailbox. Messages arrive and queue up in order. The first message to arrive is the first message processed. The second message waits until the first completes. The third waits for the second. This ordering provides deterministic execution. Given the same message sequence, the actor produces the same results.

**MainThreadExecutor = Single Thread.** The [RpcEndpoint](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-core/src/main/java/org/apache/flink/runtime/rpc/RpcEndpoint.java) base class provides a `MainThreadExecutor`. This executor runs on a single thread dedicated to the endpoint. Every RPC method executes on this thread. Every internal callback executes on this thread. Every scheduled task executes on this thread. The endpoint owns this thread exclusively.

**No Synchronization Needed.** Because all code runs on a single thread, no synchronization is necessary. The ExecutionGraph has no locks. Methods read and write state directly. Iterators remain valid because no concurrent modification is possible. The code reads like a simple single-threaded program. Developers reason about sequential execution, not thread interleavings.

### How Message Processing Works

Consider a concrete example. JobMaster receives three messages in quick succession.

Message 1 arrives from TaskManager: `updateTaskExecutionState(task=A, state=FINISHED)`. The mailbox queues this message. The main thread picks it up. JobMaster accesses ExecutionGraph, finds the execution for task A, and updates its state to FINISHED. The main thread completes processing.

Message 2 arrives from CheckpointCoordinator: `triggerCheckpoint(checkpointId=42)`. The mailbox already has this message queued. The main thread picks it up after completing Message 1. JobMaster accesses ExecutionGraph, iterates through all vertices, and triggers checkpoint 42 on each. The iteration is safe because Message 1 already completed. ExecutionGraph is in a consistent state.

Message 3 arrives from REST API: `requestJobDetails()`. The mailbox queues it behind Message 2. The main thread picks it up after completing Message 2. JobMaster reads ExecutionGraph and returns job details. The read sees all updates from Messages 1 and 2.

This sequential processing eliminates every concurrency concern. Message 2 never sees ExecutionGraph mid-update from Message 1. Message 3 always sees a consistent view. No locks required. No race conditions possible.

---

## Architecture: The RPC Abstraction Layers

Flink builds its RPC system in layers. Each layer has a specific responsibility. The layers compose to provide type-safe, single-threaded, distributed method invocation.

![Flink RPC Architecture Layers](/img/blog/flink-rpc/rpc_arch.svg)

To understand Flink's RPC architecture, it helps to draw parallels with familiar Java patterns. If you've used the AWS SDK, Apache Tomcat, or Java Servlets, you already understand the core concepts—just with different names.

### Mapping Flink RPC to Familiar Java Patterns

| Flink RPC Concept | AWS SDK Equivalent | Traditional Java Web Equivalent |
|-------------------|-------------------|--------------------------------|
| `RpcGateway` | Service Client Interface (e.g., `S3Client`) | JAX-RS Interface / REST Client Interface |
| `RpcEndpoint` | Service Handler (server-side) | Servlet / Spring Controller |
| `RpcService` (abstraction) | `SdkClientBuilder` + Connection Pool | Tomcat's `Connector` interface |
| `PekkoRpcService` (impl) | Default HTTP transport | NIO Connector implementation |
| `RpcServer` | Request Handler / Dispatcher | `DispatcherServlet` / Front Controller |
| `PekkoInvocationHandler` | SDK's HTTP Request Builder | `RestTemplate` / `WebClient` internals |
| `MainThreadExecutor` | N/A (SDK is stateless) | Single-threaded event loop (like Netty's EventLoop) |
| Actor Mailbox | N/A | Request Queue in async servers |

### RpcGateway: The Interface Contract (Like AWS SDK Service Clients)

[RpcGateway](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-core/src/main/java/org/apache/flink/runtime/rpc/RpcGateway.java) defines the contract for remote calls. It serves the same purpose as an AWS SDK service client interface.

**AWS SDK Analogy:** When you use `S3Client` from the AWS SDK, you call methods like `putObject()` or `getObject()`. You don't think about HTTP, serialization, or retries. The interface abstracts the network layer completely. `RpcGateway` does the same for Flink's internal communication.

```java
// AWS SDK pattern - you're familiar with this
public interface S3Client {
    PutObjectResponse putObject(PutObjectRequest request);
    GetObjectResponse getObject(GetObjectRequest request);
}

// Flink RPC pattern - same concept, different domain
public interface JobMasterGateway extends RpcGateway {
    CompletableFuture<Acknowledge> updateTaskExecutionState(TaskExecutionState state);
    CompletableFuture<Acknowledge> cancel(Duration timeout);
    CompletableFuture<String> triggerSavepoint(String targetDirectory, boolean cancelJob);
}
```

**Key Differences from AWS SDK:**

1. **Async by Default:** Every `RpcGateway` method returns `CompletableFuture`. AWS SDK v2 offers both sync (`S3Client`) and async (`S3AsyncClient`) variants. Flink chose async-only to make the non-blocking nature explicit. Callers never block waiting for results—they attach callbacks or chain operations.

2. **Bidirectional:** AWS SDK clients only make outbound calls. Flink gateways are bidirectional. `TaskExecutorGateway` lets JobMaster call into TaskManager. `JobMasterGateway` lets TaskManager call into JobMaster. Both sides expose gateways.

3. **Internal Network:** AWS SDK calls traverse the public internet to AWS services. Flink RPC calls stay within the cluster's internal network, typically using direct TCP connections.

[JobMasterGateway](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/jobmaster/JobMasterGateway.java) declares methods that callers can invoke on JobMaster. The interface serves as documentation—new engineers read it to understand what operations JobMaster supports. Method signatures specify exact parameter types and return types. Javadoc explains semantics. The interface is the source of truth for the RPC contract.

### RpcEndpoint: The Base Class (Like a Servlet or Spring Controller)

[RpcEndpoint](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-core/src/main/java/org/apache/flink/runtime/rpc/RpcEndpoint.java) is the server-side handler. Every distributed component extends this class. Think of it as a Servlet that handles incoming requests, but with a critical difference: all requests execute on a single thread.

**Servlet Analogy:** In a traditional Java web application, you write a Servlet to handle HTTP requests:

```java
// Traditional Servlet - Tomcat spawns a thread per request
public class OrderServlet extends HttpServlet {
    private OrderRepository repository;  // Shared state - needs synchronization!
    
    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) {
        // WARNING: Multiple threads execute this concurrently
        // Must synchronize access to repository
        synchronized(repository) {
            repository.createOrder(parseOrder(req));
        }
    }
}
```

**Flink RpcEndpoint - Same concept, but single-threaded:**

```java
// Flink RpcEndpoint - only ONE thread ever executes methods
public class JobMaster extends FencedRpcEndpoint<JobMasterId> 
        implements JobMasterGateway {
    
    private SchedulerNG schedulerNG;  // Shared state - NO synchronization needed!
    
    @Override
    public CompletableFuture<Acknowledge> updateTaskExecutionState(
            TaskExecutionState state) {
        // SAFE: Only main thread executes this
        // No locks, no synchronization, no race conditions
        schedulerNG.updateTaskExecutionState(state);
        return CompletableFuture.completedFuture(Acknowledge.get());
    }
}
```

**Why Single-Threaded Beats Multi-Threaded Here:**

Tomcat's thread-per-request model works well for stateless web applications. Each request is independent. But Flink's components maintain complex shared state (ExecutionGraph with thousands of vertices, checkpoint state, slot allocations). The single-threaded model eliminates an entire class of bugs.

**Key RpcEndpoint Features:**

1. **MainThreadExecutor:** The constructor creates a dedicated executor bound to the endpoint. All RPC calls execute through this executor. The class provides methods to schedule work on the main thread:
   - `runAsync(Runnable)` — queues a task for later execution
   - `callAsync(Callable<V>)` — queues a task and returns `CompletableFuture<V>`
   - `scheduleRunAsync(Runnable, Duration)` — queues work with a delay

2. **Lifecycle Hooks:** Like Servlet's `init()` and `destroy()`:
   - `onStart()` — runs when the endpoint begins accepting messages
   - `onStop()` — runs during shutdown
   Both execute on the main thread, making initialization and cleanup thread-safe.

3. **Thread Safety Check:** The `validateRunsInMainThread()` method catches programming errors early:

```java
protected void validateRunsInMainThread() {
    if (!rpcServer.isCurrentThreadMainThread()) {
        throw new IllegalStateException(
            "This method must be called from within the main thread.");
    }
}
```

**Component Hierarchy:**

- [JobMaster](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/jobmaster/JobMaster.java) extends `FencedRpcEndpoint` — coordinates job execution
- [TaskExecutor](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/taskexecutor/TaskExecutor.java) extends `RpcEndpoint` — runs tasks on worker nodes
- [ResourceManager](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/resourcemanager/ResourceManager.java) extends `FencedRpcEndpoint` — manages cluster resources
- [Dispatcher](https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/dispatcher/Dispatcher.java) extends `FencedRpcEndpoint` — handles job submission

### RpcService: The Factory and Connection Manager (Like Tomcat's Connector)

[RpcService](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-core/src/main/java/org/apache/flink/runtime/rpc/RpcService.java) is an **abstraction** that manages endpoint lifecycles and gateway connections. It defines the contract for how endpoints are created and how connections are established—but not *how* messages travel over the wire.

Currently, the only production implementation is [PekkoRpcService](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-akka/src/main/java/org/apache/flink/runtime/rpc/pekko/PekkoRpcService.java), which uses Pekko's actor remoting over TCP. However, the abstraction exists precisely so the transport can be swapped without changing Flink's core components. Future implementations could use:

- **gRPC** — Industry-standard RPC with HTTP/2, protobuf serialization, and mature tooling
- **HTTP/REST** — Simpler debugging, standard load balancers, firewall-friendly
- **Custom TCP** — Optimized binary protocol without Pekko's overhead

The key insight: `JobMaster`, `TaskExecutor`, and `ResourceManager` don't know or care whether messages travel via Pekko actors, gRPC streams, or HTTP requests. They only interact with the `RpcService` abstraction.

**Tomcat Analogy:** Tomcat's `Connector` accepts incoming connections, manages the thread pool, and routes requests to Servlets. `RpcService` does the same for Flink. Just as Tomcat can swap between NIO, NIO2, or APR connectors without changing your Servlets, Flink could swap RpcService implementations without changing endpoints:

| Tomcat Component | RpcService Abstraction | PekkoRpcService Implementation |
|------------------|------------------------|-------------------------------|
| `Connector` interface | `RpcService` interface | `PekkoRpcService` |
| `NioConnector` / `AprConnector` | Could be `GrpcRpcService`, `HttpRpcService` | Actor-based TCP transport |
| `ThreadPoolExecutor` | Defined by implementation | Actor mailboxes + main thread executors |
| `Mapper` (URL → Servlet) | Gateway → Endpoint routing | Actor path → RpcEndpoint routing |

**AWS SDK Analogy:** `RpcService` also resembles `SdkClientBuilder` combined with connection pooling. The SDK abstracts whether it uses Apache HttpClient, Netty, or URL Connection under the hood:

```java
// AWS SDK - builder creates configured client (transport abstracted)
S3Client s3 = S3Client.builder()
    .region(Region.US_EAST_1)
    .httpClient(NettyNioAsyncHttpClient.create())  // Could swap to ApacheHttpClient
    .build();

// Flink - RpcService abstraction (transport abstracted)
// Today: PekkoRpcService (actor-based TCP)
// Future: Could be GrpcRpcService, HttpRpcService, etc.
RpcService rpcService = new PekkoRpcService(config, actorSystem);

// These calls work identically regardless of RpcService implementation:
// Start a server (like deploying a Servlet)
rpcService.startServer(jobMaster);

// Connect to remote server (like creating SDK client)
JobMasterGateway gateway = rpcService.connect(address, JobMasterGateway.class).get();
```

**Key RpcService Responsibilities (Interface Contract):**

These responsibilities are defined by the `RpcService` interface. Any implementation—Pekko, gRPC, or HTTP—must fulfill them:

1. **Server Creation:** When JobMaster instantiates, it calls `rpcService.startServer(this)`. The implementation creates whatever underlying machinery is needed (actors for Pekko, gRPC stubs for gRPC, servlet registration for HTTP) and starts the main thread executor. The endpoint is now ready to receive messages.

2. **Client Connection:** A TaskManager needs to communicate with JobMaster on another machine. It calls `rpcService.connect(address, JobMasterGateway.class)`. The implementation returns a proxy object implementing `JobMasterGateway`. Whether that proxy sends Pekko messages, gRPC calls, or HTTP requests is an implementation detail hidden from the caller.

3. **Transport Management:** The implementation manages its transport layer—ActorSystem for Pekko, ManagedChannel for gRPC, HttpClient for HTTP. It handles configuration, connection pooling, and graceful shutdown.

**Why This Abstraction Matters:**

The Pekko (formerly Akka) license change in 2022 forced Flink to migrate from Akka to Pekko. This abstraction means a future migration to gRPC or HTTP would only require implementing a new `RpcService`—no changes to `JobMaster`, `TaskExecutor`, or `ResourceManager`.

### RpcServer: The Message Dispatcher (Like DispatcherServlet)

[RpcServer](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-core/src/main/java/org/apache/flink/runtime/rpc/RpcServer.java) is the internal component that dispatches messages to the endpoint.

**Spring MVC Analogy:** Spring's `DispatcherServlet` receives all HTTP requests, determines which controller method to invoke, and dispatches the call. `RpcServer` does the same for RPC messages:

| Spring MVC Component | Flink RpcServer Equivalent |
|---------------------|---------------------------|
| `DispatcherServlet` | `RpcServer` |
| `HandlerMapping` (URL → Controller) | Method name lookup via reflection |
| `HandlerAdapter` (invoke method) | Reflective method invocation |
| `ViewResolver` (format response) | Result serialization |

**Key RpcServer Responsibilities:**

1. **Thread Tracking:** Knows which thread is the endpoint's main thread. Provides `isCurrentThreadMainThread()` for safety checks.

2. **Method Invocation:** When a message arrives requesting `updateTaskExecutionState()`:
   - Locates the method on the endpoint class
   - Deserializes the arguments
   - Invokes the method reflectively
   - Captures the return value
   - Serializes the result and sends it back

### PekkoInvocationHandler: The Client-Side Proxy (Like AWS SDK's HTTP Layer)

[PekkoInvocationHandler](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-akka/src/main/java/org/apache/flink/runtime/rpc/pekko/PekkoInvocationHandler.java) implements `InvocationHandler` for the dynamic proxy. It converts method calls into network messages.

**AWS SDK Analogy:** When you call `s3Client.putObject(request)`, the SDK internally:
1. Serializes the request to HTTP
2. Signs the request
3. Sends over HTTPS
4. Deserializes the response

`PekkoInvocationHandler` does the same, but with Pekko's actor messaging instead of HTTP:

```java
// What you write
gateway.updateTaskExecutionState(state);

// What PekkoInvocationHandler does internally (simplified)
public Object invoke(Object proxy, Method method, Object[] args) {
    // 1. Create invocation object (like HTTP request)
    RpcInvocation invocation = new RpcInvocation(
        method.getName(),           // "updateTaskExecutionState"
        method.getParameterTypes(), // [TaskExecutionState.class]
        args                        // [state]
    );
    
    // 2. Send via actor (like HTTP send)
    CompletableFuture<Object> result = actorRef.ask(invocation, timeout);
    
    // 3. Return future (response will arrive asynchronously)
    return result;
}
```

**HttpClient Comparison:**

| Java HttpClient | PekkoInvocationHandler |
|-----------------|----------------------|
| `HttpRequest.newBuilder().uri(...).build()` | `new RpcInvocation(method, args)` |
| `client.sendAsync(request, handler)` | `actorRef.ask(invocation, timeout)` |
| HTTP/HTTPS protocol | Pekko remoting over TCP |
| JSON/XML serialization | Kryo serialization |

---

## Network Path: Client to Server Flow

When an RPC call crosses machine boundaries, a complex flow executes. Understanding this flow helps debug network-related failures.

![Flink RPC Client-Server Communication](/img/blog/flink-rpc/network_flow.svg)

### Client Side: Gateway to Network

The flow mirrors what happens in an AWS SDK call, but with actors instead of HTTP.

**Step 1: Obtain Gateway (Like Creating SDK Client)**

```java
// AWS SDK
S3Client s3 = S3Client.builder().region(Region.US_EAST_1).build();

// Flink RPC
JobMasterGateway gateway = rpcService.connect(jobMasterAddress, JobMasterGateway.class).get();
```

The `connect()` call doesn't return a real `JobMasterGateway` implementation. It returns a dynamic proxy created by `Proxy.newProxyInstance()`. The proxy implements the interface but delegates all calls to `PekkoInvocationHandler`.

**Step 2: Method Invocation (Like SDK Method Call)**

```java
// AWS SDK
PutObjectResponse response = s3.putObject(request);  // Looks local, actually remote

// Flink RPC  
CompletableFuture<Acknowledge> future = gateway.updateTaskExecutionState(state);  // Same pattern
```

The proxy intercepts the call. No business logic executes locally.

**Step 3: Create Invocation Object (Like HTTP Request Building)**

```java
// Conceptually similar to:
// HttpRequest.newBuilder()
//     .uri(URI.create("https://s3.amazonaws.com/bucket/key"))
//     .POST(BodyPublishers.ofByteArray(serialize(request)))
//     .build();

RpcInvocation invocation = new RpcInvocation(
    "updateTaskExecutionState",      // Method name (like URL path)
    new Class[]{TaskExecutionState.class},  // Parameter types
    new Object[]{state}              // Arguments (like request body)
);
```

**Step 4: Serialize and Send (Like HTTP Transport)**

```java
// AWS SDK uses HTTP client internally
// httpClient.sendAsync(httpRequest, responseHandler);

// Flink uses Pekko actor messaging
actorRef.ask(invocation, timeout);  // Pekko serializes with Kryo, sends over TCP
```

### Server Side: Network to Execution

**Step 1: TCP Receive (Like Tomcat Accepting Connection)**

The remote machine receives TCP bytes. Pekko's network layer reads the frame and routes to the target actor based on the actor path.

**Step 2: Actor Receives Message (Like Servlet.service())**

[PekkoRpcActor](https://github.com/apache/flink/blob/master/flink-rpc/flink-rpc-akka/src/main/java/org/apache/flink/runtime/rpc/pekko/PekkoRpcActor.java) receives the message in its `onReceive()` method—the entry point for all incoming messages.

```java
// Conceptually similar to:
// public void service(HttpServletRequest req, HttpServletResponse resp) {
//     String method = req.getMethod();
//     String path = req.getPathInfo();
//     // Route to appropriate handler
// }

public void onReceive(Object message) {
    if (message instanceof RpcInvocation) {
        handleRpcInvocation((RpcInvocation) message);
    }
}
```

**Step 3: Mailbox Queuing (Unlike Tomcat—This is the Key Difference)**

Here's where Flink diverges from traditional web servers. Tomcat would spawn a thread and execute immediately. Flink enqueues in the mailbox:

```
Tomcat: Request arrives → New thread → Execute handler → Return response
Flink:  Message arrives → Enqueue in mailbox → Wait turn → Main thread executes → Return response
```

The message joins the queue behind any previously arrived messages. FIFO ordering guarantees deterministic execution.

**Step 4: Main Thread Execution (Single-Threaded Handler)**

The main thread dequeues the invocation when it reaches the front. It uses reflection to call `updateTaskExecutionState(state)` on the `JobMaster` instance. The method executes with full access to internal state—no locks needed.

**Step 5: Response (Like HTTP Response)**

The method returns `CompletableFuture<Acknowledge>`. The actor captures the result, serializes it, and sends bytes back over TCP. The caller's `CompletableFuture` completes with the result.

### Complete Flow Comparison

| Step | AWS SDK (S3 PutObject) | Flink RPC (updateTaskExecutionState) |
|------|----------------------|-------------------------------------|
| 1. Interface | `S3Client.putObject(request)` | `JobMasterGateway.updateTaskExecutionState(state)` |
| 2. Proxy | SDK internal handler | `PekkoInvocationHandler` |
| 3. Serialization | JSON/XML + HTTP headers | Kryo + RpcInvocation |
| 4. Transport | HTTPS to AWS | TCP to Pekko actor |
| 5. Server receive | AWS service endpoint | `PekkoRpcActor.onReceive()` |
| 6. Routing | AWS internal routing | Actor mailbox |
| 7. Execution | AWS service logic | `JobMaster.updateTaskExecutionState()` |
| 8. Response | HTTP response | Serialized `Acknowledge` |

---

## Practical Implications

### Code Simplicity

The RpcEndpoint pattern transforms how developers write distributed coordination code. Compare two approaches to updating ExecutionGraph.

**Without RpcEndpoint (Hypothetical—Like Traditional Servlet):**

```java
// Similar to a Servlet with shared state
class JobMaster {
    private ExecutionGraph executionGraph;
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    
    void updateTaskState(TaskExecutionState state) {
        lock.writeLock().lock();
        try {
            Execution exec = executionGraph.getExecution(state.getID());
            exec.updateState(state.getExecutionState());
        } finally {
            lock.writeLock().unlock();
        }
    }
    
    JobDetails getJobDetails() {
        lock.readLock().lock();
        try {
            return JobDetails.createFrom(executionGraph);
        } finally {
            lock.readLock().unlock();
        }
    }
}
```

**With RpcEndpoint (Actual Flink):**

```java
public class JobMaster extends FencedRpcEndpoint<JobMasterId> 
        implements JobMasterGateway {
    
    private SchedulerNG schedulerNG;  // Contains ExecutionGraph
    
    @Override
    public CompletableFuture<Acknowledge> updateTaskExecutionState(
            TaskExecutionState state) {
        // No lock needed - runs on main thread
        Execution exec = schedulerNG.getExecutionGraph()
                                    .getExecution(state.getID());
        exec.updateState(state.getExecutionState());
        return CompletableFuture.completedFuture(Acknowledge.get());
    }
    
    @Override
    public CompletableFuture<JobDetails> requestJobDetails(Duration timeout) {
        // No lock needed - runs on main thread
        return CompletableFuture.completedFuture(
            JobDetails.createFrom(schedulerNG.getExecutionGraph()));
    }
}
```

The actual Flink code has no locks. Methods read and write state directly. The single-threaded guarantee is architectural, not annotational. Developers cannot forget to acquire a lock because no lock exists.

### Debugging Benefits

When investigating issues, the single-threaded model simplifies analysis. All state changes happen in sequence. Given a log of messages, you can reconstruct exact system state at any point. No thread interleavings to consider. No happens-before relationships to reason about.

Flink provides `validateRunsInMainThread()` for defensive programming. Critical methods call this check at entry. If a developer accidentally calls a state-modifying method from a wrong thread, the check throws immediately. The stack trace points to the violation. The bug is caught in development, not production.

### Performance Considerations

The single-threaded model has a trade-off. All operations serialize through one thread. High message volume can create backlog in the mailbox. The main thread becomes a bottleneck.

Flink mitigates this in practice. RPC methods are designed to be fast. They update in-memory state and return quickly. Heavy computation offloads to separate thread pools via `callAsync()`. Blocking I/O never runs on the main thread.

For most workloads, the main thread handles thousands of messages per second without issue. The simplicity and correctness benefits outweigh the throughput limitation. Debugging a race condition costs more engineering time than optimizing a hot path.

---

## Historical Context: Akka to Pekko

Flink used Akka from its early versions. Akka provided a mature, battle-tested actor implementation. Flink's usage was focused: message passing between components, single-threaded execution guarantees, and failure detection via DeathWatch.

In September 2022, Lightbend changed Akka's license from Apache 2.0 to Business Source License (BSL). This license is incompatible with Apache Software Foundation projects. Flink could not continue using new Akka versions.

The Apache Software Foundation responded by forking Akka 2.6.x as Apache Pekko. Pekko maintains Apache 2.0 licensing. It provides API compatibility with Akka 2.6.x. Migration requires updating imports from `akka.*` to `org.apache.pekko.*` and configuration keys from `akka.*` to `pekko.*`.

Flink 1.18 completed the migration to Pekko. The architecture remains identical. The single-threaded execution guarantee is unchanged. Existing Flink applications require no code changes. Only operators running custom Akka code directly (rare) need updates.

---

## Summary

Flink's RPC architecture solves a fundamental distributed systems problem. Multiple components must access shared state. Traditional locking creates complexity, deadlocks, and race conditions. The Actor Model provides an elegant alternative.

Each component extends RpcEndpoint. Each RpcEndpoint processes messages on a single thread. The mailbox queues messages in FIFO order. No concurrent access is possible. No locks are needed.

The RPC layer provides type-safe communication. RpcGateway interfaces define contracts (like AWS SDK client interfaces). Dynamic proxies implement these interfaces (like SDK internal handlers). RpcService abstracts the transport layer—currently Pekko, but designed to be swappable with gRPC or HTTP implementations. RpcEndpoint handles requests (like Servlets). The result is distributed method invocation that feels like local calls.

This architecture has served Flink well for years. It enables correct coordination across hundreds of distributed components. It simplifies debugging and testing. It allows developers to write straightforward sequential code for inherently concurrent problems.
