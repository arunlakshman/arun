import React from 'react';
import { cn } from '../../lib/utils';

/**
 * StatusIndicator - Simple status indicator component
 * @param {Object} props
 * @param {string} props.status - Status: "online" | "offline" | "warning" | "error"
 * @param {string} props.label - Status label text
 * @param {string} props.className - Additional CSS classes
 */
export default function StatusIndicator({ status = "online", label, className }) {
  const statusConfig = {
    online: {
      color: "bg-green-500",
      text: "text-green-600 dark:text-green-400",
    },
    offline: {
      color: "bg-gray-400",
      text: "text-gray-500 dark:text-gray-400",
    },
    warning: {
      color: "bg-yellow-500",
      text: "text-yellow-600 dark:text-yellow-400",
    },
    error: {
      color: "bg-red-500",
      text: "text-red-600 dark:text-red-400",
    },
  };

  const config = statusConfig[status] || statusConfig.online;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          config.color
        )}
      />
      {label && (
        <span className={cn("text-sm", config.text)}>
          {label}
        </span>
      )}
    </div>
  );
}
