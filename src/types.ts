/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type EmailCategory = 'urgent' | 'action_required' | 'newsletter' | 'personal' | 'commercial' | 'social' | 'general';

export type UrgencyLevel = 'high' | 'medium' | 'low';

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
  category?: EmailCategory;
  urgency?: UrgencyLevel;
  read: boolean;
}

export interface EmailAnalysis {
  emailId: string;
  category: EmailCategory;
  urgency: UrgencyLevel;
  urgencyReason?: string;
  summary: string;
  keyPoints: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  suggestedAction?: string;
  suggestedReply?: string;
}

export type RuleType = 'keyword' | 'sender' | 'semantic';

export interface MonitoringRule {
  id: string;
  type: RuleType;
  pattern: string; // keyword, email, or AI instructions
  description: string;
  isActive: boolean;
  color: string; // for UI badge
}

export interface MonitoringAlert {
  id: string;
  ruleId: string;
  ruleDescription: string;
  emailId: string;
  emailSubject: string;
  emailFrom: string;
  timestamp: string;
  matchedContent: string;
}

export interface AgentLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'alert' | 'error';
  message: string;
}
