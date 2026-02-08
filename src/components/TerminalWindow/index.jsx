import React from 'react';
import { cn } from '../../lib/utils';

/**
 * CodeBlock - A clean code display component (formerly TerminalWindow)
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content to display
 * @param {string} props.title - Code block title
 * @param {string} props.className - Additional CSS classes
 */
export default function TerminalWindow({ children, title = "Example", className }) {
  return (
    <div 
      className={cn("rounded-lg overflow-hidden border shadow-sm", className)}
      style={{
        borderColor: 'var(--card-border-color)',
        backgroundColor: 'var(--ifm-background-surface-color)',
      }}
    >
      {/* Header */}
      <div 
        className="flex items-center gap-2 border-b px-4 py-2"
        style={{
          backgroundColor: 'var(--ifm-background-surface-color)',
          borderBottomColor: 'var(--card-border-color)',
        }}
      >
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
          <div className="w-3 h-3 rounded-full bg-green-400"></div>
        </div>
        <div className="flex-1 text-center">
          <span 
            className="text-xs font-medium"
            style={{ color: 'var(--ifm-font-color-secondary)' }}
          >
            {title}
          </span>
        </div>
        <div className="w-12"></div>
      </div>
      
      {/* Content */}
      <div 
        className="p-4 font-mono text-sm"
        style={{
          color: 'var(--ifm-font-color-base)',
          backgroundColor: 'var(--ifm-background-color)',
        }}
      >
        <div className="space-y-1">
          {children}
        </div>
      </div>
    </div>
  );
}
