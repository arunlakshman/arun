import React from 'react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

/**
 * TechBadge - A tech stack badge component
 * @param {Object} props
 * @param {string} props.children - Badge text
 * @param {string} props.variant - Badge variant: "default" | "secondary" | "outline"
 * @param {string} props.className - Additional CSS classes
 */
export default function TechBadge({ children, variant = "secondary", className }) {
  return (
    <Badge 
      variant={variant} 
      className={cn("text-xs transition-colors", className)}
    >
      {children}
    </Badge>
  );
}
