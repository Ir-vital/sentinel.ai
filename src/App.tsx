/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Mail, ShieldAlert, Sparkles, Bell, LogOut, RefreshCw, 
  Plus, Trash2, CheckCircle, X, Terminal, Copy, Check, 
  Sliders, ArrowRight, User, AlertCircle, Play, Square, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  initAuth, googleSignIn, logout, getAccessToken 
} from './auth';
import { 
  fetchInboxEmails, classifyEmailsBatch, analyzeEmailWithAI, 
  generateInboxBriefing, generateDraftReplyWithTone 
} from './gmailService';
import { 
  Email, EmailAnalysis, EmailCategory, UrgencyLevel, 
  MonitoringRule, MonitoringAlert, AgentLog, RuleType 
} from './types';
import { 
  renderSimpleMarkdown, formatEmailDate, getInitials, generateId 
} from './utils';

// Default Monitoring Rules
const DEFAULT_RULES: MonitoringRule[] = [
  { id: 'rule-1', type: 'keyword', pattern: 'facture', description: 'Facturation & Paiement', isActive: true, color: 'bg-red-500 text-white' },
  { id: 'rule-2', type: 'keyword', pattern: 'reunion', description: 'Planification de Réunions', isActive: true, color: 'bg-amber-500 text-white' },
  { id: 'rule-3', type: 'keyword', pattern: 'urgent', description: 'Messages urgents signalés', isActive: true, color: 'bg-rose-600 text-white animate-pulse' },
  { id: 'rule-4', type: 'keyword', pattern: 'contrat', description: 'Validation de Contrats / Signatures', isActive: true, color: 'bg-emerald-500 text-white' }
];

export default function App() {
  // Authentication State
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Email & Agent States
  const [emails, setEmails] = useState<Email[]>([]);
  const [emailsLoading, setEmailsLoading] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<EmailCategory | 'all' | 'unread' | 'urgent' | 'starred' | 'processed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);

  // Inbox Brief State
  const [brief, setBrief] = useState<string>('');
  const [briefLoading, setBriefLoading] = useState<boolean>(false);
  const [briefOpen, setBriefOpen] = useState<boolean>(true);

  // Alert Rules State
  const [rules, setRules] = useState<MonitoringRule[]>(() => {
    const saved = localStorage.getItem('agent_rules');
    return saved ? JSON.parse(saved) : DEFAULT_RULES;
  });
  const [newRulePattern, setNewRulePattern] = useState<string>('');
  const [newRuleDescription, setNewRuleDescription] = useState<string>('');
  const [newRuleType, setNewRuleType] = useState<RuleType>('keyword');

  // Alerts Logged
  const [alerts, setAlerts] = useState<MonitoringAlert[]>(() => {
    const saved = localStorage.getItem('agent_alerts');
    return saved ? JSON.parse(saved) : [];
  });

  // Local Star & Processed Email tracking
  const [starredEmailIds, setStarredEmailIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('starred_emails');
    return saved ? JSON.parse(saved) : [];
  });
  const [processedEmailIds, setProcessedEmailIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('processed_emails');
    return saved ? JSON.parse(saved) : [];
  });

  // Agent Logs (Terminal)
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Email Inspector (Detail Modal)
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [emailAnalysis, setEmailAnalysis] = useState<EmailAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [replyTone, setReplyTone] = useState<string>('Professionnel');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [replyDraft, setReplyDraft] = useState<string>('');
  const [replyLoading, setReplyLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Active toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'alert' } | null>(null);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Persist Rules
  useEffect(() => {
    localStorage.setItem('agent_rules', JSON.stringify(rules));
  }, [rules]);

  // Persist Alerts
  useEffect(() => {
    localStorage.setItem('agent_alerts', JSON.stringify(alerts));
  }, [alerts]);

  // Persist Starred & Processed list
  useEffect(() => {
    localStorage.setItem('starred_emails', JSON.stringify(starredEmailIds));
  }, [starredEmailIds]);

  useEffect(() => {
    localStorage.setItem('processed_emails', JSON.stringify(processedEmailIds));
  }, [processedEmailIds]);

  // Add Log helper
  const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'alert' | 'error' = 'info') => {
    const newLog: AgentLog = {
      id: generateId(),
      timestamp: new Date().toLocaleTimeString('fr-FR'),
      type,
      message,
    };
    setLogs(prev => [...prev.slice(-99), newLog]); // Keep last 100 logs
  };

  // Show Toast helper
  const showToast = (message: string, type: 'success' | 'info' | 'alert' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Initialize Auth on page mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, activeToken) => {
        setUser(currentUser);
        setToken(activeToken);
        setNeedsAuth(false);
        setAuthLoading(false);
        addLog(`Utilisateur connecté : ${currentUser.email}`, 'success');
        showToast('Connexion Google réussie !', 'success');
        // Initial scan after login
        scanInbox(activeToken);
      },
      () => {
        setNeedsAuth(true);
        setAuthLoading(false);
        addLog('En attente de connexion de l\'utilisateur.', 'info');
      }
    );
    return () => unsubscribe();
  }, []);

  // Polling loop for active monitoring
  useEffect(() => {
    let intervalId: any;
    if (isPolling && token) {
      intervalId = setInterval(() => {
        addLog('🔄 [Surveillance Active] Lancement d\'un scan périodique automatique...', 'info');
        scanInbox(token);
      }, 45000); // scan every 45s
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPolling, token, rules]);

  // Google Login handler
  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setToken(result.accessToken);
        setNeedsAuth(false);
        addLog(`Utilisateur connecté : ${result.user.email}`, 'success');
        showToast('Connexion Google réussie !', 'success');
        scanInbox(result.accessToken);
      }
    } catch (err: any) {
      addLog(`Échec de connexion : ${err.message}`, 'error');
      showToast('Erreur de connexion', 'alert');
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setToken(null);
      setNeedsAuth(true);
      setEmails([]);
      setIsPolling(false);
      setLogs([]);
      setAlerts([]);
      setBrief('');
      showToast('Déconnecté avec succès', 'info');
    } catch (err: any) {
      console.error(err);
    }
  };

  // Core Monitoring Scanner function
  const scanInbox = async (accessToken: string) => {
    if (emailsLoading) return;
    setEmailsLoading(true);
    addLog('🔍 Agent : Connexion à l\'API Gmail...', 'info');
    
    try {
      // 1. Fetch from Gmail
      const fetched = await fetchInboxEmails(accessToken, 20);
      addLog(`📥 Agent : ${fetched.length} e-mails récupérés de la boîte de réception.`, 'success');
      
      if (fetched.length === 0) {
        setEmails([]);
        setLastScanTime(new Date());
        setEmailsLoading(false);
        addLog('📭 Agent : Boîte de réception vide.', 'info');
        return;
      }

      // 2. Classify via Gemini Server proxy
      addLog('🧠 Agent : Triage intelligent par l\'IA Gemini en cours...', 'info');
      const classified = await classifyEmailsBatch(fetched, rules);
      setEmails(classified);
      setLastScanTime(new Date());
      addLog('✅ Agent : Triage et catégorisation terminés avec succès.', 'success');

      // 3. Scan rules and trigger keyword/sender/semantic alerts
      addLog('🚨 Agent : Analyse des règles de surveillance...', 'info');
      let alertCount = 0;
      
      classified.forEach(email => {
        // Run active rules
        rules.filter(r => r.isActive).forEach(rule => {
          let isTriggered = false;
          let matchedStr = '';

          if (rule.type === 'semantic') {
            if (email.triggeredRuleIds?.includes(rule.id)) {
              isTriggered = true;
              matchedStr = 'Analyse Sémantique IA';
            }
          } else if (rule.type === 'sender') {
            const matchPattern = rule.pattern.toLowerCase();
            const senderMatch = 
              email.from.toLowerCase().includes(matchPattern) || 
              email.fromName.toLowerCase().includes(matchPattern) || 
              email.fromEmail.toLowerCase().includes(matchPattern);
            if (senderMatch) {
              isTriggered = true;
              matchedStr = 'Expéditeur';
            }
          } else {
            // default is keyword
            const matchPattern = rule.pattern.toLowerCase();
            const subjectMatch = email.subject.toLowerCase().includes(matchPattern);
            const senderMatch = email.from.toLowerCase().includes(matchPattern);
            const snippetMatch = email.snippet.toLowerCase().includes(matchPattern);
            const bodyMatch = email.body?.toLowerCase().includes(matchPattern);

            if (subjectMatch || senderMatch || snippetMatch || bodyMatch) {
              isTriggered = true;
              matchedStr = subjectMatch ? 'Objet' : senderMatch ? 'Expéditeur' : 'Contenu';
            }
          }

          if (isTriggered) {
            // Check if alert already logged to prevent duplicates
            const alertExists = alerts.some(a => a.emailId === email.id && a.ruleId === rule.id);
            if (!alertExists) {
              const newAlert: MonitoringAlert = {
                id: generateId(),
                ruleId: rule.id,
                ruleDescription: rule.description,
                emailId: email.id,
                emailSubject: email.subject,
                emailFrom: email.fromName,
                timestamp: new Date().toLocaleString('fr-FR'),
                matchedContent: rule.type === 'semantic'
                  ? `Correspondance sémantique validée par l'IA`
                  : `${matchedStr} correspond à "${rule.pattern}"`,
              };
              
              setAlerts(prev => [newAlert, ...prev]);
              addLog(`🚨 ALERTE : E-mail de "${email.fromName}" déclenche la règle "${rule.description}" !`, 'alert');
              alertCount++;
            }
          }
        });
      });

      if (alertCount > 0) {
        showToast(`${alertCount} nouvelle(s) alerte(s) détectée(s) !`, 'alert');
      } else {
        addLog('🛡️ Agent : Aucune nouvelle anomalie ou alerte détectée.', 'success');
      }

    } catch (err: any) {
      addLog(`❌ Erreur lors du scan : ${err.message}`, 'error');
      showToast('Échec du scan de la messagerie', 'alert');
    } finally {
      setEmailsLoading(false);
    }
  };

  // Generate Digest / Morning Briefing via Gemini Server proxy
  const generateBrief = async () => {
    if (emails.length === 0) {
      showToast('Aucun e-mail à résumer.', 'info');
      return;
    }
    setBriefLoading(true);
    addLog('📝 Agent : Rédaction du rapport de synthèse (Briefing d\'IA)...', 'info');
    
    try {
      const summary = await generateInboxBriefing(emails);
      setBrief(summary);
      setBriefOpen(true);
      addLog('✨ Agent : Rapport de synthèse généré avec succès !', 'success');
      showToast('Briefing généré !', 'success');
    } catch (err: any) {
      addLog(`❌ Erreur briefing : ${err.message}`, 'error');
    } finally {
      setBriefLoading(false);
    }
  };

  // Handle detailed single email analysis
  const handleSelectEmail = async (email: Email) => {
    setSelectedEmail(email);
    setAnalysisLoading(true);
    setEmailAnalysis(null);
    setReplyDraft('');
    setReplyTone('Professionnel');
    setCustomInstructions('');
    addLog(`🔍 Agent : Analyse détaillée de l'e-mail de "${email.fromName}"...`, 'info');

    try {
      const analysis = await analyzeEmailWithAI(email);
      setEmailAnalysis(analysis);
      setReplyDraft(analysis.suggestedReply || '');
      addLog('🤖 Agent : Analyse détaillée par Gemini disponible.', 'success');
    } catch (err: any) {
      addLog(`❌ Erreur analyse détaillée : ${err.message}`, 'error');
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Regenerate reply draft with custom tone or instructions
  const handleRegenerateDraft = async (tone: string, instructions?: string) => {
    if (!selectedEmail) return;
    setReplyLoading(true);
    setReplyTone(tone);
    const instructionsToUse = instructions !== undefined ? instructions : customInstructions;
    addLog(`🔄 Agent : Régénération du brouillon de réponse...`, 'info');

    try {
      const regeneratedReply = await generateDraftReplyWithTone(selectedEmail, tone, instructionsToUse);
      setReplyDraft(regeneratedReply);
      addLog('✨ Agent : Nouveau brouillon de réponse rédigé.', 'success');
      showToast('Brouillon mis à jour !', 'success');
    } catch (err: any) {
      addLog(`❌ Erreur régénération brouillon : ${err.message}`, 'error');
    } finally {
      setReplyLoading(false);
    }
  };

  // Copy reply to clipboard
  const handleCopyReply = () => {
    if (!replyDraft) return;
    navigator.clipboard.writeText(replyDraft);
    setCopied(true);
    showToast('Brouillon copié dans le presse-papiers !', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  // Rule management helpers
  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRulePattern.trim() || !newRuleDescription.trim()) return;

    const colors = [
      'bg-indigo-500 text-white',
      'bg-purple-500 text-white',
      'bg-pink-500 text-white',
      'bg-blue-500 text-white',
      'bg-teal-500 text-white',
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const newRule: MonitoringRule = {
      id: generateId(),
      type: newRuleType,
      pattern: newRulePattern.trim().toLowerCase(),
      description: newRuleDescription.trim(),
      isActive: true,
      color: randomColor,
    };

    setRules(prev => [...prev, newRule]);
    addLog(`⚙️ Agent : Nouvelle règle [${newRuleType === 'semantic' ? 'Sémantique IA' : newRuleType === 'sender' ? 'Expéditeur' : 'Mot-clé'}] ajoutée : "${newRule.description}" (${newRule.pattern})`, 'info');
    showToast('Nouvelle règle enregistrée !', 'success');
    
    // Clear form
    setNewRulePattern('');
    setNewRuleDescription('');
    setNewRuleType('keyword');
  };

  const handleToggleRule = (ruleId: string) => {
    setRules(prev => prev.map(r => {
      if (r.id === ruleId) {
        addLog(`⚙️ Agent : Règle "${r.description}" ${!r.isActive ? 'activée' : 'désactivée'}.`, 'info');
        return { ...r, isActive: !r.isActive };
      }
      return r;
    }));
  };

  const handleDeleteRule = (ruleId: string) => {
    const rule = rules.find(r => r.id === ruleId);
    if (rule) {
      setRules(prev => prev.filter(r => r.id !== ruleId));
      addLog(`⚙️ Agent : Règle supprimée : "${rule.description}"`, 'warning');
      showToast('Règle supprimée', 'info');
    }
  };

  const handleClearAlerts = () => {
    if (window.confirm('Voulez-vous vider l\'historique des alertes ?')) {
      setAlerts([]);
      addLog('🛡️ Agent : Historique des alertes réinitialisé.', 'info');
    }
  };

  // Categorization helpers for UI
  const getCategoryDetails = (category?: EmailCategory) => {
    switch (category) {
      case 'urgent':
        return { label: 'Urgent', color: 'bg-rose-950/40 text-rose-400 border border-rose-500/30 rounded-none uppercase text-[9px] font-black tracking-wider' };
      case 'action_required':
        return { label: 'Action requise', color: 'bg-amber-950/40 text-amber-400 border border-amber-500/30 rounded-none uppercase text-[9px] font-black tracking-wider' };
      case 'newsletter':
        return { label: 'Newsletter', color: 'bg-blue-950/40 text-blue-400 border border-blue-500/30 rounded-none uppercase text-[9px] font-black tracking-wider' };
      case 'personal':
        return { label: 'Personnel', color: 'bg-emerald-950/40 text-[#CCFF00] border border-[#CCFF00]/30 rounded-none uppercase text-[9px] font-black tracking-wider' };
      case 'commercial':
        return { label: 'Commercial', color: 'bg-white/5 text-white/70 border border-white/10 rounded-none uppercase text-[9px] font-black tracking-wider' };
      case 'social':
        return { label: 'Réseaux Sociaux', color: 'bg-purple-950/40 text-purple-400 border border-purple-500/30 rounded-none uppercase text-[9px] font-black tracking-wider' };
      default:
        return { label: 'Général', color: 'bg-white/5 text-white/60 border border-white/10 rounded-none uppercase text-[9px] font-black tracking-wider' };
    }
  };

  const getUrgencyBadge = (level?: UrgencyLevel) => {
    switch (level) {
      case 'high':
        return <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black bg-rose-600 text-white uppercase tracking-wider rounded-none">Élevée</span>;
      case 'medium':
        return <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black bg-amber-500 text-black uppercase tracking-wider rounded-none">Moyenne</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black bg-white/10 text-white/80 uppercase tracking-wider rounded-none border border-white/10">Faible</span>;
    }
  };

  // Filter emails list based on selection and search query
  const filteredEmails = emails.filter(email => {
    // Apply search query first
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        email.subject.toLowerCase().includes(query) ||
        email.fromName.toLowerCase().includes(query) ||
        email.fromEmail.toLowerCase().includes(query) ||
        email.snippet.toLowerCase().includes(query) ||
        (email.body && email.body.toLowerCase().includes(query));
      if (!matchesSearch) return false;
    }

    if (activeFilter === 'all') return true;
    if (activeFilter === 'unread') return !email.read;
    if (activeFilter === 'urgent') return email.urgency === 'high' || email.category === 'urgent';
    if (activeFilter === 'starred') return starredEmailIds.includes(email.id);
    if (activeFilter === 'processed') return processedEmailIds.includes(email.id);
    return email.category === activeFilter;
  });

  // Count helper for badge summaries
  const countByCategory = (cat: EmailCategory) => emails.filter(e => e.category === cat).length;
  const countUnread = emails.filter(e => !e.read).length;
  const countHighUrgency = emails.filter(e => e.urgency === 'high' || e.category === 'urgent').length;
  const countStarred = emails.filter(e => starredEmailIds.includes(e.id)).length;
  const countProcessed = emails.filter(e => processedEmailIds.includes(e.id)).length;

  // Onboarding View
  if (needsAuth) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] font-sans text-white flex flex-col justify-between selection:bg-[#CCFF00] selection:text-black relative overflow-hidden">
        {/* Top bar */}
        <header className="relative w-full max-w-7xl mx-auto px-6 py-8 flex justify-between items-end border-b border-white/15 z-10">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.4em] text-white/50 mb-1">Security Protocol v2.5</span>
            <h1 className="text-3xl font-black tracking-tighter uppercase text-white flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-[#CCFF00]" />
              <span>SENTINEL.AI</span>
            </h1>
          </div>
          <div className="flex items-center text-[10px] font-mono text-[#CCFF00] space-x-2 uppercase tracking-[0.2em] font-bold pb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#CCFF00] pulse-dot" />
            <span>Ready to Scan</span>
          </div>
        </header>

        {/* Hero Section */}
        <main className="relative max-w-5xl mx-auto px-6 py-16 flex flex-col items-center justify-center text-center space-y-12 z-10 flex-grow w-full">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-white leading-[0.9] uppercase">
              L'AGENT IA DE SURVEILLANCE <br />
              <span className="text-[#CCFF00]">DE VOTRE MESSAGERIE GMAIL</span>
            </h1>
            <p className="max-w-3xl mx-auto text-white/60 text-sm sm:text-base leading-relaxed tracking-wide font-medium">
              Sentinel.AI trie automatiquement votre boîte de réception Gmail en temps réel, 
              détecte les urgences, signale les factures ou contrats, et prépare des brouillons de réponses adaptées grâce à l'intelligence de Gemini.
            </p>
          </motion.div>

          {/* Core Feature Bento Pills */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-4xl py-4"
          >
            <div className="border border-white/15 p-6 bg-[#141414] text-left space-y-3 transition hover:border-[#CCFF00]/50">
              <div className="w-9 h-9 bg-[#CCFF00]/10 flex items-center justify-center border border-[#CCFF00]/20">
                <ShieldAlert className="w-5 h-5 text-[#CCFF00]" />
              </div>
              <h3 className="font-black text-xs uppercase tracking-widest text-[#CCFF00]">Surveillance Active</h3>
              <p className="text-xs text-white/65 leading-relaxed">Configurez des règles d'alerte personnalisées pour être alerté instantanément lors de détection de mots-clés.</p>
            </div>

            <div className="border border-white/15 p-6 bg-[#141414] text-left space-y-3 transition hover:border-[#CCFF00]/50">
              <div className="w-9 h-9 bg-white/5 flex items-center justify-center border border-white/10">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-black text-xs uppercase tracking-widest text-white">Briefing de l'IA</h3>
              <p className="text-xs text-white/65 leading-relaxed">Générez un briefing matinal complet rédigé par Gemini résumant l'état et les actions requises de votre boîte mail.</p>
            </div>

            <div className="border border-white/15 p-6 bg-[#141414] text-left space-y-3 transition hover:border-[#CCFF00]/50">
              <div className="w-9 h-9 bg-white/5 flex items-center justify-center border border-white/10">
                <Mail className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-black text-xs uppercase tracking-widest text-white">Brouillons de réponse</h3>
              <p className="text-xs text-white/65 leading-relaxed">Visualisez instantanément des analyses approfondies et des propositions de réponses prêtes à être copiées.</p>
            </div>
          </motion.div>

          {/* Secure Note */}
          <div className="border border-white/15 p-5 bg-[#141414]/50 max-w-2xl text-left space-y-2">
            <div className="flex items-start space-x-4">
              <AlertCircle className="w-5 h-5 text-[#CCFF00] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-black uppercase tracking-wider text-[#CCFF00]">Confidentialité & Sécurité Totales</p>
                <p className="text-3xs text-white/50 leading-normal font-mono">
                  Pour votre sécurité, cette application demande des droits d'accès <span className="text-white font-bold">strictement limités à la lecture seule (gmail.readonly)</span>. 
                  L'agent ne stocke pas vos messages sur une base de données externe et n'a pas la permission d'envoyer ni de supprimer de messages.
                </p>
              </div>
            </div>
          </div>

          {/* Official styled sign in button */}
          <div className="pt-4">
            {authLoading ? (
              <div className="flex items-center space-x-3 text-white/60 font-mono text-xs uppercase tracking-wider">
                <RefreshCw className="w-4 h-4 animate-spin text-[#CCFF00]" />
                <span>Chargement de la session sécurisée...</span>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="bg-[#CCFF00] hover:bg-[#CCFF00]/90 text-black font-black uppercase tracking-wider py-4 px-8 border border-black shadow-lg transition duration-150 cursor-pointer hover:scale-[1.02] active:scale-[0.98] text-sm"
              >
                <div className="flex items-center space-x-3">
                  <Mail className="w-5 h-5" />
                  <span>SE CONNECTER AVEC GOOGLE</span>
                </div>
              </button>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="w-full text-center py-8 border-t border-white/15 text-[10px] uppercase font-bold tracking-[0.2em] text-white/45 font-mono">
          <span>Sentinel Applet • Powered by Gemini Flash • France/UTC Time 2026</span>
        </footer>
      </div>
    );
  }

  // Active Authenticated Dashboard View
  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white font-sans flex flex-col selection:bg-[#CCFF00] selection:text-black">
      
      {/* Toast Alert Banner */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-4"
          >
            <div className={`p-4 rounded-none shadow-2xl flex items-center justify-between border ${
              toast.type === 'alert' 
                ? 'bg-rose-950 border-rose-500 text-rose-200' 
                : toast.type === 'info'
                ? 'bg-zinc-900 border-white/20 text-white'
                : 'bg-emerald-950 border-[#CCFF00] text-emerald-200'
            }`}>
              <div className="flex items-center space-x-3">
                {toast.type === 'alert' ? <ShieldAlert className="w-5 h-5 text-rose-500" /> : <Sparkles className="w-5 h-5 text-[#CCFF00]" />}
                <p className="text-xs font-black uppercase tracking-wide leading-tight">{toast.message}</p>
              </div>
              <button onClick={() => setToast(null)} className="text-white/60 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Header */}
      <header className="sticky top-0 bg-[#0D0D0D]/95 backdrop-blur-md border-b border-white/15 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-[0.4em] text-white/50 mb-0.5">Security Protocol v2.5</span>
            <h1 className="text-2xl font-black tracking-tighter uppercase text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#CCFF00]" />
              <span>SENTINEL.AI</span>
            </h1>
          </div>

          <div className="flex items-center space-x-4">
            {/* Active Radar Status indicator */}
            <div className="flex gap-6 items-center">
              <div className="flex flex-col items-end">
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#CCFF00] font-black">System Status</span>
                <span className="text-xs font-bold tracking-widest flex items-center gap-1.5 uppercase font-mono">
                  <span className={`w-1.5 h-1.5 rounded-full ${isPolling ? 'bg-[#CCFF00] pulse-dot' : 'bg-white/40'}`} />
                  {isPolling ? 'ACTIVE_SCAN' : 'IDLE'}
                </span>
              </div>

              {/* User Account Capsule */}
              {user && (
                <div className="flex items-center space-x-3 pl-4 border-l border-white/15">
                  <div className="hidden md:flex flex-col text-right">
                    <span className="text-xs font-black uppercase text-white leading-tight truncate max-w-[150px]">{user.displayName || user.email.split('@')[0]}</span>
                    <span className="text-[10px] font-mono text-white/40 truncate max-w-[150px]">{user.email}</span>
                  </div>
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Avatar" className="w-8 h-8 rounded border border-white/20" />
                  ) : (
                    <div className="w-8 h-8 bg-white/10 border border-white/20 flex items-center justify-center text-white font-black text-xs uppercase">
                      {getInitials(user.displayName || user.email)}
                    </div>
                  )}
                  <button 
                    onClick={handleLogout}
                    title="Se déconnecter"
                    className="p-1.5 border border-white/10 bg-white/5 hover:bg-[#CCFF00] hover:text-black transition text-white shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-grow grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Hand Sidebar Section (Agent Controllers & Logs) */}
        <section className="lg:col-span-4 space-y-6">
          
          {/* Main Control Panel Card */}
          <div className="bg-[#141414] border border-white/15 p-6 space-y-6">
            <h2 className="text-xs font-black uppercase tracking-widest text-white/50 flex items-center space-x-2 pb-3 border-b border-white/10">
              <Sliders className="w-4 h-4 text-[#CCFF00]" />
              <span>Contrôle de l'Agent</span>
            </h2>

            <div className="space-y-3">
              {/* Trigger Instant Scan button */}
              <button 
                onClick={() => token && scanInbox(token)}
                disabled={emailsLoading}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3.5 bg-[#CCFF00] hover:bg-[#CCFF00]/90 disabled:bg-white/10 disabled:text-white/30 text-black font-black text-xs uppercase tracking-wider transition cursor-pointer"
              >
                {emailsLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Scan et triage en cours...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Scanner la boîte de réception</span>
                  </>
                )}
              </button>

              {/* Toggle polling monitoring button */}
              <button 
                onClick={() => {
                  setIsPolling(!isPolling);
                  addLog(isPolling ? '⏹️ Surveillance automatique désactivée.' : '▶️ Surveillance active démarrée (scan toutes les 45s).', 'info');
                  showToast(isPolling ? 'Surveillance désactivée' : 'Surveillance active lancée !', isPolling ? 'info' : 'success');
                }}
                className={`w-full flex items-center justify-center space-x-2 px-4 py-3 border text-xs font-black uppercase tracking-wider transition cursor-pointer ${
                  isPolling 
                    ? 'bg-rose-950/40 border-rose-500/50 text-rose-200 hover:bg-rose-950/60' 
                    : 'bg-white/5 border-white/15 text-white hover:bg-white/10 hover:border-white/30'
                }`}
              >
                {isPolling ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Désactiver la Surveillance Active</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current text-[#CCFF00]" />
                    <span>Activer la Surveillance Active</span>
                  </>
                )}
              </button>
            </div>

            {/* Last Scan Status */}
            <div className="flex justify-between items-center text-[10px] font-mono text-white/40 border-t border-white/10 pt-4">
              <span>STATUT : {isPolling ? 'ACTIF (45S)' : 'EN VEILLE'}</span>
              <span>DERNIER SCAN : {lastScanTime ? lastScanTime.toLocaleTimeString('fr-FR') : 'AUCUN'}</span>
            </div>
          </div>

          {/* Monitoring Keyword/Sender/Semantic Rules Widget */}
          <div className="bg-[#141414] border border-white/15 p-6 space-y-6">
            <h2 className="text-xs font-black uppercase tracking-widest text-white/50 flex items-center justify-between pb-3 border-b border-white/10">
              <span className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-[#CCFF00]" />
                <span>Règles d'Alerte</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-black bg-white/10 text-[#CCFF00] border border-white/10 font-mono uppercase">
                {rules.filter(r => r.isActive).length} ACTIVES
              </span>
            </h2>

            {/* Rules List */}
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
              {rules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/10 hover:bg-white/10 transition">
                  <div className="flex items-start space-x-3">
                    <button 
                      onClick={() => handleToggleRule(rule.id)}
                      className={`w-4.5 h-4.5 border flex items-center justify-center transition cursor-pointer ${
                        rule.isActive ? 'bg-[#CCFF00] border-[#CCFF00] text-black' : 'bg-transparent border-white/20 text-transparent'
                      }`}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-2xs font-black text-white">{rule.description}</p>
                        <span className="px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase border border-[#CCFF00]/30 text-[#CCFF00]">
                          {rule.type === 'semantic' ? 'IA Sémantique' : rule.type === 'sender' ? 'Expéditeur' : 'Mot-clé'}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-white/50 mt-1 uppercase tracking-wider">
                        Cible : <span className="text-[#CCFF00]">"{rule.pattern}"</span>
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-1 text-white/40 hover:text-rose-400 hover:bg-rose-950/30 transition border border-transparent hover:border-rose-500/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Rule Quick Form */}
            <form onSubmit={handleAddRule} className="border-t border-white/10 pt-4 space-y-4">
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Créer une nouvelle règle</p>
              
              {/* Rule Type Selector */}
              <div className="flex bg-[#0D0D0D] border border-white/15 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setNewRuleType('keyword');
                    setNewRulePattern('');
                  }}
                  className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                    newRuleType === 'keyword' ? 'bg-[#CCFF00] text-black font-black' : 'text-white/50 hover:text-white'
                  }`}
                >
                  Mot-clé
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewRuleType('sender');
                    setNewRulePattern('');
                  }}
                  className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                    newRuleType === 'sender' ? 'bg-[#CCFF00] text-black font-black' : 'text-white/50 hover:text-white'
                  }`}
                >
                  Expéditeur
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewRuleType('semantic');
                    setNewRulePattern('');
                  }}
                  className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                    newRuleType === 'semantic' ? 'bg-[#CCFF00] text-black font-black' : 'text-white/50 hover:text-white'
                  }`}
                >
                  IA Sémantique
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input 
                  type="text" 
                  placeholder={
                    newRuleType === 'keyword' 
                      ? "ex: facture" 
                      : newRuleType === 'sender' 
                        ? "ex: paypal.com" 
                        : "ex: demande de devis"
                  } 
                  value={newRulePattern}
                  onChange={e => setNewRulePattern(e.target.value)}
                  className="px-3 py-2 border border-white/15 text-xs bg-[#0D0D0D] text-white placeholder-white/30 focus:bg-[#0D0D0D] focus:outline-none focus:border-[#CCFF00] transition"
                />
                <input 
                  type="text" 
                  placeholder="Nom (ex: Facturation)" 
                  value={newRuleDescription}
                  onChange={e => setNewRuleDescription(e.target.value)}
                  className="px-3 py-2 border border-white/15 text-xs bg-[#0D0D0D] text-white placeholder-white/30 focus:bg-[#0D0D0D] focus:outline-none focus:border-[#CCFF00] transition"
                />
              </div>
              <button 
                type="submit"
                disabled={!newRulePattern.trim() || !newRuleDescription.trim()}
                className="w-full flex items-center justify-center space-x-2 py-2.5 bg-white/5 hover:bg-[#CCFF00] hover:text-black hover:border-black disabled:hover:bg-white/5 disabled:hover:text-white/30 disabled:opacity-40 text-white border border-white/15 font-black uppercase tracking-wider text-xs transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter la règle</span>
              </button>
            </form>
          </div>

          {/* Rolling Agent Terminal Activity Log */}
          <div className="bg-[#141414] border border-white/15 p-6 space-y-4 font-mono">
            <h2 className="text-3xs font-black uppercase tracking-widest text-white/50 flex items-center justify-between pb-3 border-b border-white/10">
              <span className="flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#CCFF00]" />
                <span>Console d'activité</span>
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-[#CCFF00] pulse-dot" />
            </h2>

            <div className="h-[180px] overflow-y-auto space-y-2 pr-1 text-[11px] leading-relaxed">
              {logs.length === 0 ? (
                <p className="text-white/30 italic">Console prête en attente d'actions...</p>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="flex items-start space-x-1.5">
                    <span className="text-white/30 shrink-0">[{log.timestamp}]</span>
                    <span className={
                      log.type === 'error' ? 'text-rose-400 font-bold' :
                      log.type === 'alert' ? 'text-[#CCFF00] font-black uppercase tracking-wide' :
                      log.type === 'success' ? 'text-[#CCFF00]' :
                      log.type === 'warning' ? 'text-amber-400 font-bold' : 'text-white/70'
                    }>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
          
        </section>

        {/* Right Hand Section (Main Stage containing Email List, Rules alerts, IA Brief) */}
        <main className="lg:col-span-8 space-y-6">

          {/* Triggered Alerts Alert Box */}
          {alerts.length > 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="bg-rose-950/20 border border-rose-500/50 p-6 space-y-4"
            >
              <div className="flex justify-between items-center pb-2 border-b border-rose-500/20">
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-5 h-5 text-rose-500 animate-pulse" />
                  <h3 className="font-black text-xs text-rose-400 uppercase tracking-widest">
                    Alertes de Sécurité & Filtrage ({alerts.length})
                  </h3>
                </div>
                <button 
                  onClick={handleClearAlerts}
                  className="text-[10px] font-black text-rose-400 hover:text-rose-300 underline uppercase tracking-widest cursor-pointer"
                >
                  Effacer l'historique
                </button>
              </div>

              <div className="space-y-2.5 max-h-[140px] overflow-y-auto pr-1">
                {alerts.map(alert => {
                  const matchingEmail = emails.find(e => e.id === alert.emailId);
                  return (
                    <div 
                      key={alert.id}
                      onClick={() => matchingEmail && handleSelectEmail(matchingEmail)}
                      className="p-3 bg-rose-950/30 border border-rose-500/20 flex justify-between items-center hover:bg-rose-950/50 hover:border-rose-500/40 cursor-pointer transition"
                    >
                      <div className="flex items-center space-x-3 text-xs">
                        <span className="px-2 py-0.5 bg-rose-600 text-white font-black text-[9px] uppercase tracking-wider">
                          {alert.ruleDescription}
                        </span>
                        <div className="truncate max-w-[280px] xs:max-w-[380px] sm:max-w-none text-white font-bold">
                          <span>{alert.emailSubject}</span>
                          <span className="mx-2 text-white/30 font-mono">•</span>
                          <span className="text-white/60 font-medium">De : {alert.emailFrom}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 font-mono text-[10px] text-white/40 shrink-0 pl-2">
                        <span>{alert.matchedContent}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-white/40" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* AI Daily Briefing / Digest Panel */}
          <div className="bg-[#141414] border border-white/15 overflow-hidden">
            <button 
              onClick={() => setBriefOpen(!briefOpen)}
              className="w-full px-6 py-5 flex justify-between items-center hover:bg-white/5 transition cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 bg-white/5 border border-white/10 flex items-center justify-center text-[#CCFF00]">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-black text-xs text-white uppercase tracking-widest">Briefing de l'IA & Recommandations</h3>
                  <p className="text-[10px] font-mono uppercase text-white/40 mt-1">Généré par Gemini d'après l'état global de votre messagerie</p>
                </div>
              </div>
              <span className="px-3 py-1.5 border border-white/15 bg-transparent text-white font-black uppercase text-[10px] tracking-wider hover:bg-white/5 transition shrink-0">
                {briefOpen ? 'Masquer' : 'Afficher'}
              </span>
            </button>

            {briefOpen && (
              <div className="border-t border-white/15 bg-[#0D0D0D]/30 p-6 space-y-4">
                {briefLoading ? (
                  <div className="py-12 flex flex-col items-center justify-center space-y-3">
                    <RefreshCw className="w-6 h-6 animate-spin text-[#CCFF00]" />
                    <p className="text-xs text-white/60 font-mono uppercase tracking-wider">L'agent d'IA étudie vos e-mails et rédige le briefing...</p>
                  </div>
                ) : brief ? (
                  <div className="space-y-4">
                    <div 
                      className="markdown-body p-5 bg-[#0D0D0D] border border-white/10 leading-relaxed max-h-[350px] overflow-y-auto text-white/90 text-sm"
                      dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(brief) }}
                    />
                    <div className="flex justify-end">
                      <button 
                        onClick={generateBrief}
                        className="flex items-center space-x-2 px-4 py-2.5 border border-white/15 bg-white/5 hover:bg-[#CCFF00] hover:text-black hover:border-black text-xs font-black uppercase tracking-wider transition cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Mettre à jour le Briefing</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center space-y-4">
                    <p className="text-xs text-white/60">Aucun briefing rédigé pour le moment. Laissez l'agent d'IA résumer votre messagerie !</p>
                    <button 
                      onClick={generateBrief}
                      disabled={emails.length === 0 || emailsLoading}
                      className="inline-flex items-center space-x-2 px-5 py-3 bg-[#CCFF00] hover:bg-[#CCFF00]/90 disabled:bg-white/10 disabled:text-white/30 disabled:border-transparent text-black font-black uppercase tracking-wider text-xs transition cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Rédiger mon briefing de messagerie</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Inbox Email list */}
          <div className="bg-[#141414] border border-white/15 p-6 space-y-6">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 pb-4 border-b border-white/10">
              <div className="flex items-center space-x-3 shrink-0">
                <Mail className="w-5 h-5 text-[#CCFF00]" />
                <h2 className="text-xs font-black uppercase tracking-widest text-white">
                  Boîte de Réception ({filteredEmails.length})
                </h2>
              </div>

              {/* Search Bar & Filtering Controls */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full xl:w-auto">
                {/* Search Bar Input */}
                <div className="relative flex-grow sm:flex-grow-0 sm:w-60">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Rechercher un e-mail..."
                    className="w-full pl-8 pr-3 py-1.5 border border-white/15 text-xs bg-[#0D0D0D] text-white placeholder-white/30 focus:outline-none focus:border-[#CCFF00] transition font-mono"
                  />
                  <div className="absolute left-2.5 top-2.5 text-white/30">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2 text-white/50 hover:text-white text-xs font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-1 bg-[#0D0D0D] p-1 border border-white/10">
                  <button 
                    onClick={() => setActiveFilter('all')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                      activeFilter === 'all' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    Tous
                  </button>
                  <button 
                    onClick={() => setActiveFilter('unread')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer relative ${
                      activeFilter === 'unread' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    Non-lus
                    {countUnread > 0 && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500" />
                    )}
                  </button>
                  <button 
                    onClick={() => setActiveFilter('urgent')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer relative ${
                      activeFilter === 'urgent' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    Urgents
                    {countHighUrgency > 0 && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500" />
                    )}
                  </button>
                  <button 
                    onClick={() => setActiveFilter('starred')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer relative ${
                      activeFilter === 'starred' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    ★ Favoris
                    {countStarred > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-white/10 text-[8px] font-mono">{countStarred}</span>
                    )}
                  </button>
                  <button 
                    onClick={() => setActiveFilter('processed')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer relative ${
                      activeFilter === 'processed' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    ✓ Traités
                    {countProcessed > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-white/10 text-[8px] font-mono">{countProcessed}</span>
                    )}
                  </button>
                  <button 
                    onClick={() => setActiveFilter('action_required')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                      activeFilter === 'action_required' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    Actions
                  </button>
                  <button 
                    onClick={() => setActiveFilter('newsletter')}
                    className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                      activeFilter === 'newsletter' ? 'bg-[#CCFF00] text-black' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    News
                  </button>
                </div>
              </div>
            </div>

            {/* Email list or empty state */}
            {emailsLoading && emails.length === 0 ? (
              <div className="py-20 text-center space-y-4">
                <RefreshCw className="w-8 h-8 animate-spin text-[#CCFF00] mx-auto" />
                <p className="text-xs text-white/50 font-mono uppercase tracking-wider">Récupération sécurisée de vos e-mails de Gmail...</p>
              </div>
            ) : filteredEmails.length === 0 ? (
              <div className="py-20 text-center border border-dashed border-white/15 bg-[#0D0D0D]/40 space-y-3">
                <p className="text-sm font-black text-white/60 uppercase tracking-widest">Aucun e-mail trouvé</p>
                <p className="text-xs text-white/40 font-mono uppercase tracking-wider">Vos e-mails apparaîtront ici dès qu'un scan sera lancé.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEmails.map(email => {
                  const catDetails = getCategoryDetails(email.category);
                  const isUrgent = email.urgency === 'high';
                  // Check if matching any rule for red warning outline
                  const matchesRule = rules.some(r => r.isActive && (
                    r.type === 'semantic' ? email.triggeredRuleIds?.includes(r.id) :
                    r.type === 'sender' ? (
                      email.from.toLowerCase().includes(r.pattern) ||
                      email.fromName.toLowerCase().includes(r.pattern) ||
                      email.fromEmail.toLowerCase().includes(r.pattern)
                    ) : (
                      email.subject.toLowerCase().includes(r.pattern) || 
                      email.from.toLowerCase().includes(r.pattern) ||
                      email.snippet.toLowerCase().includes(r.pattern)
                    )
                  ));

                   return (
                    <div 
                      key={email.id}
                      onClick={() => handleSelectEmail(email)}
                      className={`p-5 border cursor-pointer transition flex items-start space-x-4 ${
                        matchesRule 
                          ? 'bg-rose-950/20 border-rose-500/40 hover:bg-rose-950/35' 
                          : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                      } ${!email.read ? 'border-l-4 border-l-[#CCFF00]' : ''}`}
                    >
                      {/* Avatar initials with dot if unread */}
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 bg-white/5 border border-white/10 flex items-center justify-center text-[#CCFF00] font-black text-xs font-mono">
                          {getInitials(email.fromName)}
                        </div>
                        {!email.read && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#CCFF00]" />
                        )}
                      </div>

                      {/* Content block */}
                      <div className="flex-grow min-w-0 space-y-1.5">
                        <div className="flex justify-between items-start gap-2">
                          <p className={`text-xs truncate font-black ${!email.read ? 'text-[#CCFF00]' : 'text-white/80'}`}>
                            {email.fromName}
                          </p>
                          <div className="flex items-center space-x-2 shrink-0">
                            {starredEmailIds.includes(email.id) && (
                              <span className="text-[#CCFF00] text-xs" title="Favori">★</span>
                            )}
                            {processedEmailIds.includes(email.id) && (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" title="Traité" />
                            )}
                            <span className="text-[10px] font-mono text-white/40 pl-1 shrink-0 uppercase tracking-wider">
                              {formatEmailDate(email.date)}
                            </span>
                          </div>
                        </div>

                        <h4 className={`text-xs truncate font-black leading-snug ${!email.read ? 'text-white' : 'text-white/70'}`}>
                          {email.subject}
                        </h4>

                        <p className="text-[11px] text-white/50 line-clamp-1 font-mono">
                          {email.snippet}
                        </p>

                        {/* Badges footer */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                          <span className={`px-2 py-0.5 border ${catDetails.color}`}>
                            {catDetails.label}
                          </span>
                          {getUrgencyBadge(email.urgency)}
                          
                          {/* Matches rule badge */}
                          {matchesRule && (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-rose-600 text-white font-black text-[9px] uppercase tracking-wider">
                              <ShieldAlert className="w-3 h-3" />
                              <span>Alerte Règle</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Floating Side-Over Inspector / Modal for Detailed Email view */}
      <AnimatePresence>
        {selectedEmail && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex justify-end">
            
            {/* Modal Backdrop overlay click to close */}
            <div className="absolute inset-0" onClick={() => setSelectedEmail(null)} />

            {/* Main inspector card body */}
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl bg-[#0D0D0D] border-l border-l-white/15 h-full flex flex-col justify-between text-white"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#141414]">
                <div className="flex items-center space-x-3 text-xs font-black uppercase tracking-widest text-white">
                  <div className="w-9 h-9 bg-white/5 border border-white/10 flex items-center justify-center text-[#CCFF00] shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <span>Inspecteur d'E-mails d'IA</span>
                </div>
                <div className="flex items-center space-x-2">
                  {/* Star toggle button */}
                  <button 
                    onClick={() => {
                      const isStarred = starredEmailIds.includes(selectedEmail.id);
                      if (isStarred) {
                        setStarredEmailIds(prev => prev.filter(id => id !== selectedEmail.id));
                        showToast('Retiré des favoris', 'info');
                      } else {
                        setStarredEmailIds(prev => [...prev, selectedEmail.id]);
                        showToast('Ajouté aux favoris !', 'success');
                      }
                    }}
                    className={`p-2 border transition cursor-pointer flex items-center justify-center ${
                      starredEmailIds.includes(selectedEmail.id)
                        ? 'bg-[#CCFF00]/10 border-[#CCFF00] text-[#CCFF00]'
                        : 'border-white/10 bg-white/5 hover:border-white/20 text-white/60 hover:text-white'
                    }`}
                    title={starredEmailIds.includes(selectedEmail.id) ? 'Retirer des favoris' : 'Marquer comme favori'}
                  >
                    <span className="text-sm">★</span>
                  </button>

                  {/* Processed toggle button */}
                  <button 
                    onClick={() => {
                      const isProcessed = processedEmailIds.includes(selectedEmail.id);
                      if (isProcessed) {
                        setProcessedEmailIds(prev => prev.filter(id => id !== selectedEmail.id));
                        showToast('E-mail marqué comme non traité', 'info');
                      } else {
                        setProcessedEmailIds(prev => [...prev, selectedEmail.id]);
                        showToast('E-mail marqué comme traité !', 'success');
                      }
                    }}
                    className={`p-2 border transition cursor-pointer flex items-center justify-center ${
                      processedEmailIds.includes(selectedEmail.id)
                        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                        : 'border-white/10 bg-white/5 hover:border-white/20 text-white/60 hover:text-white'
                    }`}
                    title={processedEmailIds.includes(selectedEmail.id) ? 'Marquer comme non traité' : 'Marquer comme traité'}
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>

                  <button 
                    onClick={() => setSelectedEmail(null)}
                    className="p-2 border border-transparent hover:border-white/15 bg-transparent hover:bg-white/5 text-white/60 hover:text-white transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable contents split into Email body & AI analysis */}
              <div className="flex-grow overflow-y-auto p-6 space-y-6">
                
                {/* Email details */}
                <div className="space-y-3 border-b border-white/10 pb-6">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`px-2.5 py-1 border ${getCategoryDetails(selectedEmail.category).color}`}>
                      {getCategoryDetails(selectedEmail.category).label}
                    </span>
                    {getUrgencyBadge(selectedEmail.urgency)}
                  </div>

                  <h3 className="text-base font-black text-white leading-tight tracking-tight">
                    {selectedEmail.subject}
                  </h3>

                  <div className="flex justify-between items-center text-xs text-white/50 font-mono flex-wrap gap-2">
                    <div className="space-y-1">
                      <p><span className="text-white/30 font-black uppercase">De:</span> {selectedEmail.from}</p>
                      {selectedEmail.to && <p><span className="text-white/30 font-black uppercase">À:</span> {selectedEmail.to}</p>}
                    </div>
                    <span className="shrink-0 pl-4 uppercase font-bold text-[10px]">{selectedEmail.date}</span>
                  </div>
                </div>

                {/* AI Agent Insights Panel */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-[#CCFF00]" />
                    <span>Rapport de l'Agent d'IA (Gemini)</span>
                  </h4>

                  {analysisLoading ? (
                    <div className="p-6 bg-white/5 border border-white/10 flex flex-col items-center justify-center space-y-3">
                      <RefreshCw className="w-6 h-6 animate-spin text-[#CCFF00]" />
                      <p className="text-xs text-white font-mono uppercase tracking-wider">Analyse d'intelligence artificielle en cours...</p>
                      <p className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Gemini synthétise le contenu et prépare un brouillon de réponse.</p>
                    </div>
                  ) : emailAnalysis ? (
                    <div className="space-y-4">
                      
                      {/* Urgency Alert Notice */}
                      {emailAnalysis.urgency === 'high' && (
                        <div className="p-4 bg-rose-950/40 border border-rose-500/50 flex items-start space-x-3">
                          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5 animate-pulse" />
                          <div className="space-y-1">
                            <p className="text-xs font-black text-rose-300 uppercase tracking-wide">Urgence Élevée Signalée !</p>
                            <p className="text-xs text-rose-200/80 leading-relaxed">{emailAnalysis.urgencyReason || 'Cet e-mail contient des consignes ou demandes nécessitant une attention immédiate.'}</p>
                          </div>
                        </div>
                      )}

                      {/* Brief AI Summary */}
                      <div className="bg-white/5 border border-white/10 p-5 space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Résumé global</p>
                        <p className="text-xs text-white/90 leading-relaxed font-bold">
                          {emailAnalysis.summary}
                        </p>
                      </div>

                      {/* Two Column details: Points & Next action */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white/5 border border-white/10 p-5 space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Points clés à retenir</p>
                          <ul className="space-y-1.5">
                            {emailAnalysis.keyPoints.map((pt, i) => (
                              <li key={i} className="text-xs text-white/85 flex items-start space-x-2 leading-relaxed">
                                <span className="text-[#CCFF00] shrink-0 font-bold">•</span>
                                <span>{pt}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-white/5 border border-white/10 p-5 space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Action recommandée</p>
                          <div className="flex items-start space-x-2 pt-1">
                            <div className="w-5 h-5 bg-[#CCFF00]/10 border border-[#CCFF00]/20 flex items-center justify-center shrink-0">
                              <CheckCircle className="w-3.5 h-3.5 text-[#CCFF00]" />
                            </div>
                            <div>
                              <p className="text-[10px] font-black text-[#CCFF00] uppercase tracking-wider">Next Step</p>
                              <p className="text-xs text-white/80 leading-normal">{emailAnalysis.suggestedAction || 'Aucune action requise.'}</p>
                            </div>
                          </div>
                          
                          {/* Sentiment */}
                          <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                            <span className="text-[10px] text-white/40 font-black uppercase tracking-wider">Tonalité :</span>
                            <span className={`px-2 py-0.5 text-[9px] font-black capitalize ${
                              emailAnalysis.sentiment === 'positive' ? 'bg-emerald-950/40 text-[#CCFF00] border border-[#CCFF00]/30' :
                              emailAnalysis.sentiment === 'negative' ? 'bg-rose-950/40 text-rose-400 border border-rose-500/30' :
                              'bg-white/5 text-white/70 border border-white/10'
                            }`}>
                              {emailAnalysis.sentiment === 'positive' ? '😊 Positive' : 
                               emailAnalysis.sentiment === 'negative' ? '⚠️ Négative / Tendue' : 
                               '😐 Neutre'}
                            </span>
                          </div>
                        </div>
                      </div>

                       {/* AI Response Draft widget */}
                      <div className="bg-[#141414] border border-white/15 p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-white/10 pb-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center space-x-1.5">
                            <Sparkles className="w-4 h-4 text-[#CCFF00]" />
                            <span>Proposition de réponse de l'Agent</span>
                          </p>

                          {/* Tone selector */}
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Ton :</span>
                            <select 
                              value={replyTone}
                              onChange={e => handleRegenerateDraft(e.target.value)}
                              disabled={replyLoading}
                              className="bg-[#0D0D0D] text-white border border-white/15 text-xs font-black p-1.5 focus:outline-none focus:border-[#CCFF00] cursor-pointer"
                            >
                              <option value="Professionnel">Professionnel</option>
                              <option value="Amical / Chaleureux">Amical</option>
                              <option value="Direct / Concis">Concis</option>
                              <option value="Négociateur / Ferme">Ferme</option>
                              <option value="S'excuser pour retard">S'excuser retard</option>
                            </select>
                          </div>
                        </div>

                        {/* Custom reply instructions area */}
                        <div className="space-y-1.5 border-b border-white/5 pb-3">
                          <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Consignes personnalisées (Optionnel) :</span>
                          <div className="flex gap-2">
                            <textarea
                              rows={1}
                              value={customInstructions}
                              onChange={e => setCustomInstructions(e.target.value)}
                              placeholder="ex: Proposer un appel mardi prochain à 14h..."
                              disabled={replyLoading}
                              className="flex-grow bg-[#0D0D0D] text-white border border-white/15 text-xs font-mono p-2 focus:outline-none focus:border-[#CCFF00] resize-none h-9 leading-normal"
                            />
                            <button
                              onClick={() => handleRegenerateDraft(replyTone, customInstructions)}
                              disabled={replyLoading}
                              className="px-4 py-2 bg-[#CCFF00] hover:bg-[#CCFF00]/90 text-black font-black text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center shrink-0 disabled:opacity-40"
                            >
                              Générer
                            </button>
                          </div>
                        </div>

                        {replyLoading ? (
                          <div className="py-8 flex items-center justify-center space-x-2 text-white/60">
                            <RefreshCw className="w-4 h-4 animate-spin text-[#CCFF00]" />
                            <span className="text-xs font-mono uppercase tracking-wider">Réécriture du brouillon...</span>
                          </div>
                        ) : replyDraft ? (
                          <div className="space-y-3">
                            <pre className="text-xs font-sans text-white/90 whitespace-pre-wrap leading-relaxed max-h-[180px] overflow-y-auto bg-[#0D0D0D] p-4 border border-white/10">
                              {replyDraft}
                            </pre>
                            
                            {/* Actions on response */}
                            <div className="flex justify-between items-center pt-2">
                              <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Copiez le brouillon et utilisez-le pour répondre</span>
                              <button 
                                onClick={handleCopyReply}
                                className="flex items-center space-x-2 px-4 py-2.5 bg-white text-black hover:bg-[#CCFF00] text-xs font-black uppercase tracking-wider transition cursor-pointer"
                              >
                                {copied ? (
                                  <>
                                    <Check className="w-4 h-4 text-emerald-600" />
                                    <span>Copié !</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-4 h-4" />
                                    <span>Copier la réponse</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-white/40 italic font-mono uppercase">Aucun brouillon rédigé.</p>
                        )}
                      </div>

                    </div>
                  ) : (
                    <div className="p-5 bg-white/5 border border-white/10 text-center text-xs text-white/60 font-mono uppercase">
                      Rapport d'analyse non disponible.
                    </div>
                  )}
                </div>

                {/* Original Email Body content */}
                <div className="space-y-3 border-t border-white/10 pt-6">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center space-x-1.5">
                    <Mail className="w-3.5 h-3.5 text-white/40" />
                    <span>Contenu original de l'e-mail</span>
                  </h4>
                  <div className="bg-white/5 border border-white/10 p-5 max-h-[250px] overflow-y-auto">
                    <p className="text-xs text-white/85 whitespace-pre-wrap leading-relaxed">
                      {selectedEmail.body || selectedEmail.snippet}
                    </p>
                  </div>
                </div>

              </div>

              {/* Read Only Disclaimer / Footer */}
              <div className="p-6 border-t border-white/10 bg-[#141414] flex flex-col space-y-2">
                <p className="text-xs font-black text-rose-400 flex items-center space-x-2 uppercase tracking-widest">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Mode Sécurisé Lecture Seule Actif</span>
                </p>
                <p className="text-[10px] font-mono text-white/40 leading-normal uppercase tracking-wider">
                  Pour des raisons de sécurité, Sentinel n'a que des droits de lecture seule. Pour envoyer votre réponse, veuillez copier la proposition ci-dessus et l'envoyer directement depuis votre application Gmail habituelle.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
