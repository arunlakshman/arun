import Heading from '@theme/Heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@site/src/components/ui/card';
import StatusIndicator from '@site/src/components/StatusIndicator';

const FeatureList = [
  {
    title: 'Infrastructure as Code',
    icon: '⚙️',
    description: (
      <>
        Comprehensive guides for Kubernetes, Docker, Terraform, and cloud infrastructure.
        Learn to deploy and manage infrastructure at scale.
      </>
    ),
    status: 'online',
  },
  {
    title: 'Stream Processing',
    icon: '⚡',
    description: (
      <>
        Master Apache Flink, Kafka, and real-time data processing. Build scalable
        streaming applications with practical examples and tutorials.
      </>
    ),
    status: 'online',
  },
  {
    title: 'Developer Tools',
    icon: '🛠️',
    description: (
      <>
        Code examples, best practices, and tutorials. From Java to Python, learn
        the tools and techniques used by infrastructure engineers.
      </>
    ),
    status: 'online',
  },
];

function Feature({icon, title, description, status}) {
  return (
    <Card className="h-full transition-all hover:shadow-glow-green">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">{icon}</span>
          <CardTitle className="font-mono">{title}</CardTitle>
        </div>
        <StatusIndicator status={status} label="ACTIVE" />
      </CardHeader>
      <CardContent>
        <CardDescription className="leading-relaxed">
          {description}
        </CardDescription>
      </CardContent>
    </Card>
  );
}

export default function HomepageFeatures() {
  return (
    <section 
      className="py-20"
      style={{ backgroundColor: 'var(--ifm-background-surface-color)' }}
    >
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <Heading 
            as="h2" 
            className="text-4xl font-bold mb-4 font-mono"
            style={{ color: 'var(--terminal-green)' }}
          >
            Features
          </Heading>
          <p className="font-mono" style={{ color: 'var(--ifm-font-color-secondary)' }}>
            Everything you need to build and deploy infrastructure
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
