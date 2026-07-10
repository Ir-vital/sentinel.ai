/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Simple markdown renderer that outputs safe HTML styled with Tailwind
export const renderSimpleMarkdown = (text: string): string => {
  if (!text) return '';
  
  // Basic escaping to prevent injection while allowing our own tags
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Restore some safe characters or formats
  // Headlines
  html = html.replace(/^### (.*?)$/gm, '<h3 class="text-sm font-bold text-slate-800 mt-4 mb-1.5">$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2 class="text-md font-bold text-slate-900 mt-5 mb-2 border-b border-slate-100 pb-1">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 class="text-lg font-extrabold text-slate-900 mt-6 mb-3">$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>');
  
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em class="italic text-slate-800">$1</em>');

  // Lists - we wrap list items with ul if needed, or just let them stand with custom padding
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li class="ml-5 list-disc text-slate-600 my-1 text-sm">$1</li>');

  // Handle line breaks
  const paragraphs = html.split('\n\n');
  const formatted = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<li')) {
      return trimmed;
    }
    return `<p class="text-slate-600 my-1.5 leading-relaxed text-sm">${trimmed}</p>`;
  });

  return formatted.join('\n');
};

// Format Google dates beautifully (e.g. "Fri, 10 Jul 2026 12:45:00 GMT")
export const formatEmailDate = (dateStr: string): string => {
  try {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    
    // Check if valid date
    if (isNaN(date.getTime())) {
      return dateStr; // fallback
    }

    const today = new Date();
    const isToday = date.getDate() === today.getDate() &&
                    date.getMonth() === today.getMonth() &&
                    date.getFullYear() === today.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dateStr;
  }
};

// Extract initials for avatars (e.g., "John Doe" -> "JD")
export const getInitials = (name: string): string => {
  if (!name) return 'A';
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

// Generate random ID
export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};
