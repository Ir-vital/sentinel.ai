/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Email, EmailAnalysis, EmailCategory, UrgencyLevel } from './types';

// Helper to get header value safely
const getHeader = (headers: { name: string; value: string }[], name: string): string => {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
};

// Parse From header to extract name and email
const parseFromHeader = (fromValue: string): { name: string; email: string } => {
  const match = fromValue.match(/^(.*?)\s*<([^>]+)>/);
  if (match) {
    return {
      name: match[1].replace(/['"]/g, '').trim() || match[2],
      email: match[2].trim(),
    };
  }
  return {
    name: fromValue,
    email: fromValue,
  };
};

// Recursively parse the email body from parts
const extractBody = (part: any): string => {
  if (!part) return '';

  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeGmailBody(part.body.data);
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    // If we only have HTML, we return it but it can be stripped of HTML tags later
    return decodeGmailBody(part.body.data);
  }

  if (part.parts && Array.isArray(part.parts)) {
    for (const subPart of part.parts) {
      const body = extractBody(subPart);
      if (body) return body;
    }
  }

  return '';
};

// Safe base64url decoding
function decodeGmailBody(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const binString = atob(base64);
    const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.error('Error decoding base64:', e);
    return '';
  }
}

// Clean HTML to text helper (rudimentary but prevents raw tags from flooding the LLM)
export const stripHtml = (html: string): string => {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const fetchInboxEmails = async (accessToken: string, maxResults = 15): Promise<Email[]> => {
  try {
    // 1. Fetch message list
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=label:INBOX`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      throw new Error(`Gmail API List failed: ${listRes.statusText}`);
    }

    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }

    // 2. Fetch detailed message details in parallel
    const detailPromises = listData.messages.map(async (msg: any) => {
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
      const detailRes = await fetch(detailUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!detailRes.ok) {
        console.warn(`Failed to fetch email details for ${msg.id}`);
        return null;
      }

      return detailRes.json();
    });

    const detailedMessages = await Promise.all(detailPromises);
    const parsedEmails: Email[] = [];

    for (const msg of detailedMessages) {
      if (!msg) continue;

      const headers = msg.payload?.headers || [];
      const fromVal = getHeader(headers, 'from');
      const { name: fromName, email: fromEmail } = parseFromHeader(fromVal);
      const subject = getHeader(headers, 'subject') || '(Pas de sujet)';
      const to = getHeader(headers, 'to');
      const date = getHeader(headers, 'date');
      const snippet = msg.snippet || '';
      const read = !msg.labelIds?.includes('UNREAD');

      // Try to parse full plain-text body
      let body = extractBody(msg.payload);
      if (body.includes('<html') || body.includes('<div')) {
        body = stripHtml(body);
      }
      if (!body) {
        body = snippet;
      }

      parsedEmails.push({
        id: msg.id,
        threadId: msg.threadId,
        subject,
        from: fromVal,
        fromName,
        fromEmail,
        to,
        date,
        snippet,
        body: body.substring(0, 5000), // Cap size for Gemini context safety
        read,
      });
    }

    return parsedEmails;
  } catch (error) {
    console.error('Error fetching emails from Gmail:', error);
    throw error;
  }
};

// Deeply fetch single email body
export const fetchSingleEmailBody = async (accessToken: string, emailId: string): Promise<string> => {
  try {
    const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}?format=full`;
    const detailRes = await fetch(detailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!detailRes.ok) {
      throw new Error(`Failed to fetch body for email ${emailId}`);
    }

    const msg = await detailRes.json();
    let body = extractBody(msg.payload);
    if (body.includes('<html') || body.includes('<div')) {
      body = stripHtml(body);
    }
    return body || msg.snippet || '';
  } catch (error) {
    console.error('Error fetching email body:', error);
    return '';
  }
};

// Batch classify emails using backend
export const classifyEmailsBatch = async (emails: Email[]): Promise<Email[]> => {
  try {
    const response = await fetch('/api/classify-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch batch classification from backend');
    }

    const { classifications } = await response.json();
    if (!classifications || !Array.isArray(classifications)) {
      return emails;
    }

    // Merge classification results back into original email objects
    return emails.map(email => {
      const match = classifications.find((c: any) => c.id === email.id);
      if (match) {
        return {
          ...email,
          category: match.category as EmailCategory,
          urgency: match.urgency as UrgencyLevel,
        };
      }
      return {
        ...email,
        category: 'general' as EmailCategory,
        urgency: 'low' as UrgencyLevel,
      };
    });
  } catch (error) {
    console.error('Error in classifyEmailsBatch:', error);
    // Fallback categories if backend has issue
    return emails.map(e => ({ ...e, category: 'general', urgency: 'low' }));
  }
};

// Deep analyze single email using backend
export const analyzeEmailWithAI = async (email: Email): Promise<EmailAnalysis> => {
  try {
    const response = await fetch('/api/analyze-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch detailed analysis from backend');
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error in analyzeEmailWithAI:', error);
    // Return a structured error response
    return {
      emailId: email.id,
      category: 'general',
      urgency: 'low',
      summary: 'Erreur lors de l\'analyse de cet e-mail par l\'agent d\'IA.',
      keyPoints: ['Échec de connexion au serveur d\'intelligence artificielle.'],
      sentiment: 'neutral',
      suggestedAction: 'Veuillez réessayer l\'analyse.',
      suggestedReply: 'Bonjour, j\'ai bien reçu votre e-mail et je reviens vers vous rapidement. Cordialement.',
    };
  }
};

// Regenerate reply draft with custom tone
export const generateDraftReplyWithTone = async (email: Email, tone: string): Promise<string> => {
  try {
    const response = await fetch('/api/generate-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tone }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate draft with tone');
    }

    const data = await response.json();
    return data.suggestedReply || 'Désolé, impossible de générer un brouillon pour le moment.';
  } catch (error) {
    console.error('Error in generateDraftReplyWithTone:', error);
    return 'Erreur de connexion lors de la génération du brouillon.';
  }
};

// Generate overall inbox briefing using backend
export const generateInboxBriefing = async (emails: Email[]): Promise<string> => {
  try {
    const response = await fetch('/api/inbox-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate briefing from backend');
    }

    const data = await response.json();
    return data.summary || 'Erreur lors de la génération du briefing.';
  } catch (error) {
    console.error('Error in generateInboxBriefing:', error);
    return 'Désolé, l\'agent n\'a pas pu générer le briefing de votre boîte de réception à ce moment.';
  }
};
