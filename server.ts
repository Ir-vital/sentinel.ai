import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support JSON bodies
  app.use(express.json());

  // Lazy-loaded Gemini client helper
  let aiClient: GoogleGenAI | null = null;
  function getGeminiClient() {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not configured. Please add it in the Secrets panel.');
      }
      aiClient = new GoogleGenAI({ apiKey });
    }
    return aiClient;
  }

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Batch classify emails for the dashboard
  app.post('/api/classify-batch', async (req, res) => {
    try {
      const { emails } = req.body;
      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: 'Invalid emails list provided' });
      }

      if (emails.length === 0) {
        return res.json({ classifications: [] });
      }

      const ai = getGeminiClient();
      const prompt = `You are an expert AI email triage assistant. Given a list of emails (each with id, subject, sender, and body snippet), categorize each email and determine its urgency level.
Categories allowed: 'urgent' | 'action_required' | 'newsletter' | 'personal' | 'commercial' | 'social' | 'general'
Urgency levels allowed: 'high' | 'medium' | 'low'

Emails list:
${JSON.stringify(emails.map(e => ({ id: e.id, subject: e.subject, from: e.from, snippet: e.snippet })), null, 2)}

Return a JSON object containing an array of classifications. Match the email 'id' exactly.
Structure:
{
  "classifications": [
    {
      "id": "email_id",
      "category": "urgent" | "action_required" | "newsletter" | "personal" | "commercial" | "social" | "general",
      "urgency": "high" | "medium" | "low"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (error: any) {
      console.error('Error in batch classification:', error);
      res.status(500).json({ error: error.message || 'Failed to classify emails' });
    }
  });

  // Deep analyze a single email
  app.post('/api/analyze-email', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.id) {
        return res.status(400).json({ error: 'No email provided for analysis' });
      }

      const ai = getGeminiClient();
      const prompt = `You are an expert AI email monitoring agent. Analyze the following email:
ID: ${email.id}
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Snippet: ${email.snippet}
Body: ${email.body || 'No full body available, analyze the snippet.'}

Analyze the email text and return a JSON object with this exact structure:
{
  "emailId": "${email.id}",
  "category": "urgent" | "action_required" | "newsletter" | "personal" | "commercial" | "social" | "general",
  "urgency": "high" | "medium" | "low",
  "urgencyReason": "Brief explanation of why this is urgent/important, or null",
  "summary": "1-2 sentence concise summary of the email",
  "keyPoints": ["point 1", "point 2", "up to 4 critical points"],
  "sentiment": "positive" | "neutral" | "negative",
  "suggestedAction": "Brief actionable next step (e.g. 'Pay by July 15', 'Schedule a meeting')",
  "suggestedReply": "A polite, helpful, and professional draft reply on behalf of the user. IMPORTANT: Detect the language of the email (e.g., French or English) and write this reply in that SAME language."
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (error: any) {
      console.error('Error in email deep analysis:', error);
      res.status(500).json({ error: error.message || 'Failed to analyze email' });
    }
  });

  // Regenerate a reply draft with a specific tone
  app.post('/api/generate-reply', async (req, res) => {
    try {
      const { email, tone } = req.body;
      if (!email || !email.id) {
        return res.status(400).json({ error: 'No email provided for reply drafting' });
      }

      const ai = getGeminiClient();
      const prompt = `You are an expert AI email virtual assistant. Write a polite, professional, and helpful draft reply on behalf of the user to the following email:
Subject: ${email.subject}
From: ${email.from}
Snippet: ${email.snippet}
Body: ${email.body || email.snippet}

The draft reply MUST match the following tone: "${tone || 'professional'}".
Options are:
- "Professionnel" (Professional, standard, respectful, clear)
- "Amical / Chaleureux" (Friendly, warm, close, enthusiastic)
- "Direct / Concis" (Direct, short, brief, concise, straight to the point)
- "Négociateur / Ferme" (Negotiating, firm, assertive, business-driven)
- "S'excuser pour retard" (Apologizing, polite, acknowledging late response, constructive)

IMPORTANT RULES:
1. Write the reply in the SAME language as the incoming email (detect if French, English, etc.).
2. Do not include any brackets like [Name] or placeholders if possible; write a complete, natural-sounding message. If you must use placeholders, use standard realistic ones or omit them gracefully.
3. Return a JSON object with this exact structure:
{
  "suggestedReply": "Your draft email reply here"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (error: any) {
      console.error('Error in drafting reply:', error);
      res.status(500).json({ error: error.message || 'Failed to generate reply draft' });
    }
  });

  // Generate an inbox summary overview (Morning/Daily Briefing)
  app.post('/api/inbox-summary', async (req, res) => {
    try {
      const { emails } = req.body;
      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: 'Invalid emails list' });
      }

      if (emails.length === 0) {
        return res.json({ summary: 'Votre boîte de réception est vide.' });
      }

      const ai = getGeminiClient();
      const prompt = `You are an advanced AI email monitoring agent. Provide a professional, engaging, and high-level briefing of the user's inbox (Morning/Daily Briefing) in French based on the following list of emails:

${JSON.stringify(emails.map(e => ({
  subject: e.subject,
  from: e.from,
  date: e.date,
  category: e.category || 'non classé',
  urgency: e.urgency || 'low',
  snippet: e.snippet
})), null, 2)}

Provide a cohesive, elegant markdown-formatted summary including:
1. **Overview**: A 2-sentence friendly check-in summarizing the inbox status today.
2. **Urgent Alerts**: List any highly urgent emails and why they require immediate attention.
3. **Action Items**: A clean bulleted list of key tasks or actions requested by senders.
4. **General Trends**: Summarize other messages like newsletters, personal, or commercial updates.

IMPORTANT: Write the entire response in French. Use markdown styling, emojis where appropriate, and keep it neat and easy to read. Do not include technical file paths or ID details.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      res.json({ summary: response.text || 'Erreur lors de la génération du briefing.' });
    } catch (error: any) {
      console.error('Error in generating briefing:', error);
      res.status(500).json({ error: error.message || 'Failed to generate briefing' });
    }
  });

  // --- Vite Dev / Production Middlewares ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode.`);
  });
}

startServer();
