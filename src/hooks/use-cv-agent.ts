'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { deactivateToClinic } from '@/lib/deactivate-to-clinic';
import { publishActiveAgentSync } from '@/lib/active-agent-sync';
import {
  activateAgent,
  fetchAgentMessages,
  fetchAgentSessions,
  getActiveAgent,
  openAgentSession,
  parseAgentReply,
  sendAgentChat,
} from '@/lib/agent-api';
import { isAgentBlocked, isPaywallError } from '@/lib/api-errors';
import {
  followAgentEscalation,
  parseAgentEscalation,
} from '@/lib/agent-escalation';
import { CV_BUILDER_AGENT_ID } from '@/lib/cv-agent-config';
import { consumeCvAgentHandoff } from '@/lib/cv-agent-handoff';
import { parseAssistantEnvelope } from '@/lib/chat-envelope';
import {
  handleAgentEnvelope,
} from '@/lib/handle-agent-envelope';
import {
  mapAgentHistoryToChatMessages,
  resolveWorkflowFromMessages,
  type RawAgentHistoryMessage,
} from '@/lib/agent-sessions';
import { buildCvWorkflowFromPipeline } from '@/lib/workflow-catalog';
import { useAgentTransition } from '@/components/agent-transition/agent-transition-provider';
import { isNavigationPending, planNavigation } from '@/lib/agent-transition';
import {
  extractCvMetaButtons,
  extractCvPreviewFromAgent,
  extractCvReplyFromAgent,
  hydrateCvMetaFromAgentHistory,
  patchDiffFromAgentMeta,
  patchPipelineStateFromMeta,
  patchDocumentIdFromMeta,
  resolveAgentMeta,
  extractCvParsedSections,
  type CvPreviewContent,
} from '@/lib/cv-api';
import { uploadCvResumeFile, resolveCvUploadErrorMessage } from '@/lib/cv-input-api';
import {
  exportCvDocumentPdf,
  exportCvDocumentDocx,
  switchCvDocumentTemplate,
  resolveCvExportErrorMessage,
} from '@/lib/cv-export-api';
import { publishWorkspaceAssetsInvalidate } from '@/lib/workspace-assets-invalidate';
import { useAuthStore, useAgentStore, useUIStore } from '@/lib/store';
import { normalizeAgentSessions, isAgentSessionReadOnly } from '@/lib/agent-sessions';
import { consumeSessionNavHandoff } from '@/lib/session-nav-handoff';
import {
  SESSION_NAV_OPEN_FILE_EVENT,
  SESSION_NAV_SELECT_HISTORY_EVENT,
  SESSION_NAV_SESSION_EXITED_EVENT,
  SESSION_NAV_SESSION_OPENED_EVENT,
  type SessionNavSelectHistoryDetail,
  type SessionNavSessionOpenedDetail,
} from '@/lib/session-nav-events';
import type {
  ActivateAgentResponse,
  AgentChatResponse,
  AgentSessionSummary,
  CvChatMessage,
  CvDiffPayload,
} from '@/types';
import type { ChatNextAction } from '@/types/chat-envelope';

function nextId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Seeded welcome — matches Hub entry contract assistant-turn pattern (KAZI-164). */
export const CV_CHAT_WELCOME_ID = 'cv_chat_welcome';

function applyAgentMetaSideEffects(
  data: Pick<AgentChatResponse, 'meta' | 'response'>,
  openPaywall: (code: string) => void
): boolean {
  const meta = resolveAgentMeta(data);
  const errorCode = meta?.error_code;
  if (errorCode && isPaywallError({ errorCode })) {
    openPaywall(errorCode);
    return true;
  }
  return false;
}

export type CvAgentSendResult =
  | { ok: true; escalated?: true }
  | { ok: false; error?: string };

export function useCvAgent(jobId?: string | null, options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;
  const params = useParams();
  const router = useRouter();
  const locale = typeof params.locale === 'string' ? params.locale : 'en';
  const t = useTranslations('cv');
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const showToast = useUIStore((s) => s.showToast);
  const openPaywall = useUIStore((s) => s.openPaywall);
  const activateGenRef = useRef(0);

  const { activateAgentWithoutPrecheck } = useAgentTransition();

  const cvWorkflowLabels = useMemo(
    () => ({
      intake: t('workflow.intake'),
      analyze: t('workflow.analyze'),
      generate: t('workflow.generate'),
      review: t('workflow.review'),
      done: t('workflow.done'),
    }),
    [t]
  );

  const resolveWorkflowFromResponse = useCallback(
    (data: AgentChatResponse) => {
      const envelope = parseAssistantEnvelope(data);
      if (envelope.workflow) return envelope.workflow;
      const meta = resolveAgentMeta(data);
      const ps =
        typeof meta?.pipeline_state === 'string' ? meta.pipeline_state : null;
      return buildCvWorkflowFromPipeline(ps, cvWorkflowLabels);
    },
    [cvWorkflowLabels]
  );

  const [messages, setMessages] = useState<CvChatMessage[]>([]);
  const [preview, setPreview] = useState<CvPreviewContent | null>(null);
  const [diff, setDiff] = useState<CvDiffPayload | null>(null);
  const [pipelineState, setPipelineState] = useState<string | null>(null);
  const [nextActions, setNextActions] = useState<ChatNextAction[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isOpening, setIsOpening] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isSwitchingTemplate, setIsSwitchingTemplate] = useState(false);
  const [parsedSections, setParsedSections] = useState<Record<string, string> | null>(null);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [escalationRecoveryTarget, setEscalationRecoveryTarget] = useState<
    string | null
  >(null);
  const [sessionResumed, setSessionResumed] = useState(false);

  const finishSessionLoad = useCallback((gen: number) => {
    if (gen === activateGenRef.current) {
      setIsLoading(false);
      setIsOpening(false);
    }
  }, []);

  const beginSessionOpen = useCallback(() => {
    setIsOpening(true);
    setIsLoading(true);
  }, []);

  const applyEmptySessionGreeting = useCallback((greeting?: string) => {
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      if (greeting?.trim()) {
        return [{ id: nextId('cv'), role: 'assistant', content: greeting.trim() }];
      }
      return [{ id: CV_CHAT_WELCOME_ID, role: 'assistant', content: t('agentWelcome') }];
    });
  }, [t]);

  const loadSessionMessages = useCallback(
    async (sid: string, gen: number) => {
      const hist = await fetchAgentMessages(sid);
      if (gen !== activateGenRef.current) return;

      if (!hist.success) {
        setError(hist.error ?? 'Failed to load session');
        setMessages([]);
        setPreview(null);
        setDiff(null);
        setPipelineState(null);
        return;
      }

      if (hist.data?.messages?.length) {
        setMessages(
          mapAgentHistoryToChatMessages(
            hist.data.messages as RawAgentHistoryMessage[],
            sid
          )
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: m.id,
              role: m.role as CvChatMessage['role'],
              content: m.content,
              ...(m.nextActions ? { nextActions: m.nextActions } : {}),
              ...(m.cards ? { cards: m.cards } : {}),
              ...(m.workflow ? { workflow: m.workflow } : {}),
            }))
        );
        hydrateCvMetaFromAgentHistory(hist.data.messages, {
          setPipelineState,
          setPreview,
          setDiff,
          setParsedSections,
          setDocumentId,
        });
        if (hist.data.pipeline_state) {
          setPipelineState(hist.data.pipeline_state);
        }
        return;
      }

      // Empty history — greeting/welcome applied after session open + hydrate.
    },
    []
  );

  const refreshSessions = useCallback(async () => {
    if (!enabled || !isLoggedIn) return;
    setSessionsLoading(true);
    const res = await fetchAgentSessions(CV_BUILDER_AGENT_ID);
    if (res.success && res.data) {
      setSessions(normalizeAgentSessions(res.data.sessions));
    }
    setSessionsLoading(false);
  }, [enabled, isLoggedIn]);

  const applyCtaState = useCallback((data: AgentChatResponse | ActivateAgentResponse) => {
    // Transitional: global nextActions feeds composer QuickReplies; routed CTAs prefer
    // per-message nextActions on the last assistant bubble (KAZI-129).
    const { nextActions: actions } = parseAgentReply(data as AgentChatResponse);
    if (actions.length > 0) {
      setNextActions(actions);
    }
    const buttons = extractCvMetaButtons(data);
    if (buttons.length > 0) {
      setQuickReplies(buttons);
    }
  }, []);

  const applyResponse = useCallback(
    (data: AgentChatResponse, options?: { skipReply?: boolean }) => {
      applyAgentMetaSideEffects(data, openPaywall);

      if (!options?.skipReply) {
        const reply = extractCvReplyFromAgent(data);
        if (reply) {
          const { assistant } = handleAgentEnvelope(data);
          const workflow =
            assistant.workflow ?? resolveWorkflowFromResponse(data);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId('cv'),
              role: 'assistant',
              content: reply,
              workflow,
              ...(assistant.nextActions
                ? { nextActions: assistant.nextActions }
                : {}),
              ...(assistant.cards ? { cards: assistant.cards } : {}),
            },
          ]);
        }
      }
      const nextPreview = extractCvPreviewFromAgent(data);
      if (nextPreview) {
        setPreview(nextPreview);
      }
      patchDiffFromAgentMeta(data, setDiff);
      patchPipelineStateFromMeta(data, setPipelineState);
      patchDocumentIdFromMeta(data, setDocumentId);
      applyCtaState(data);
      const sections = extractCvParsedSections(data);
      if (sections) setParsedSections(sections);
      if (data.session_id) {
        setSessionId(data.session_id);
      }
    },
    [applyCtaState, openPaywall, resolveWorkflowFromResponse]
  );

  const applyActivateResponse = useCallback(
    (data: ActivateAgentResponse) => {
      applyAgentMetaSideEffects(data, openPaywall);
      const nextPreview = extractCvPreviewFromAgent(data);
      if (nextPreview) {
        setPreview(nextPreview);
      }
      patchDiffFromAgentMeta(data, setDiff);
      patchPipelineStateFromMeta(data, setPipelineState);
      patchDocumentIdFromMeta(data, setDocumentId);
      applyCtaState(data);
    },
    [applyCtaState, openPaywall]
  );

  /** Idempotent open to sync meta (document_id, preview) after history-only loads. */
  const syncOpenMeta = useCallback(
    async (gen: number): Promise<string | undefined> => {
      const res = await openAgentSession(CV_BUILDER_AGENT_ID, locale, {
        job_id: jobId ?? undefined,
      });
      if (gen !== activateGenRef.current) return undefined;
      if (res.success && res.data) {
        useAgentStore.getState().setAgentSession(
          CV_BUILDER_AGENT_ID,
          res.data.session_id
        );
        applyActivateResponse(res.data);
        return res.data.greeting;
      }
      return undefined;
    },
    [applyActivateResponse, jobId, locale]
  );

  const handleApiError = useCallback(
    (res: { error?: string; errorCode?: string }) => {
      if (res.errorCode === 'ONBOARDING_INCOMPLETE') {
        setNeedsOnboarding(true);
        setError(null);
        return;
      }
      if (isAgentBlocked(res)) {
        setNeedsProfile(true);
        setError(null);
        return;
      }
      if (isPaywallError(res) && res.errorCode) {
        openPaywall(res.errorCode);
        setError(null);
        return;
      }
      setError(res.error ?? 'Failed to start CV session');
    },
    [openPaywall]
  );

  const startSession = useCallback(async () => {
    if (!enabled) return;
    const gen = ++activateGenRef.current;
    beginSessionOpen();
    setError(null);
    setNeedsOnboarding(false);
    setNeedsProfile(false);
    setIsReadOnly(false);
    setSessionResumed(false);
    setParsedSections(null);
    setDocumentId(null);
    setSessionId(null);

    const handoff = consumeCvAgentHandoff();
    const navHandoffSessionId = consumeSessionNavHandoff(CV_BUILDER_AGENT_ID);
    const handoffSessionId = handoff?.sessionId ?? navHandoffSessionId;

    if (!handoffSessionId) {
      const activeRes = await getActiveAgent();
      if (gen !== activateGenRef.current) return;
      if (
        activeRes.success &&
        activeRes.data?.active_agent === CV_BUILDER_AGENT_ID &&
        activeRes.data.session_id
      ) {
        const sid = activeRes.data.session_id;
        setSessionId(sid);
        setSessionResumed(true);
        await loadSessionMessages(sid, gen);
        const openGreeting = await syncOpenMeta(gen);
        if (gen !== activateGenRef.current) return;
        applyEmptySessionGreeting(handoff?.greeting ?? openGreeting);
        finishSessionLoad(gen);
        void refreshSessions();
        return;
      }
    }

    if (handoffSessionId) {
      setSessionId(handoffSessionId);
      setSessionResumed(Boolean(navHandoffSessionId || handoff?.sessionId));
      await loadSessionMessages(handoffSessionId, gen);
      const openGreeting = await syncOpenMeta(gen);
      if (gen !== activateGenRef.current) return;
      applyEmptySessionGreeting(handoff?.greeting ?? openGreeting);
      finishSessionLoad(gen);
      void refreshSessions();
      return;
    }

    const res = await openAgentSession(CV_BUILDER_AGENT_ID, locale, {
      job_id: jobId ?? undefined,
    });
    if (gen !== activateGenRef.current) return;

    if (!res.success || !res.data) {
      handleApiError(res);
      finishSessionLoad(gen);
      return;
    }

    const { session_id, greeting, resumed } = res.data;
    setSessionId(session_id);
    setSessionResumed(Boolean(resumed));
    useAgentStore.getState().setAgentSession(CV_BUILDER_AGENT_ID, session_id);
    publishActiveAgentSync({
      type: 'activated',
      agentId: CV_BUILDER_AGENT_ID,
      sessionId: session_id,
    });
    if (resumed) {
      await loadSessionMessages(session_id, gen);
      applyActivateResponse(res.data);
      applyEmptySessionGreeting(greeting);
    } else {
      applyActivateResponse(res.data);
      applyEmptySessionGreeting(greeting);
    }
    finishSessionLoad(gen);
    void refreshSessions();
  }, [
    applyActivateResponse,
    applyEmptySessionGreeting,
    beginSessionOpen,
    enabled,
    finishSessionLoad,
    handleApiError,
    jobId,
    loadSessionMessages,
    locale,
    refreshSessions,
    syncOpenMeta,
  ]);

  const resyncSession = useCallback(async () => {
    if (!enabled || !isLoggedIn) return;
    const gen = ++activateGenRef.current;
    beginSessionOpen();
    setError(null);

    const res = await openAgentSession(CV_BUILDER_AGENT_ID, locale, {
      job_id: jobId ?? undefined,
    });
    if (gen !== activateGenRef.current) return;

    if (!res.success || !res.data) {
      handleApiError(res);
      finishSessionLoad(gen);
      return;
    }

    const { session_id } = res.data;
    setSessionId(session_id);
    setSessionResumed(Boolean(res.data.resumed));
    useAgentStore.getState().setAgentSession(CV_BUILDER_AGENT_ID, session_id);
    await loadSessionMessages(session_id, gen);
    applyActivateResponse(res.data);
    applyEmptySessionGreeting(res.data.greeting);
    finishSessionLoad(gen);
    void refreshSessions();
  }, [
    applyActivateResponse,
    applyEmptySessionGreeting,
    beginSessionOpen,
    enabled,
    finishSessionLoad,
    handleApiError,
    isLoggedIn,
    jobId,
    loadSessionMessages,
    locale,
    refreshSessions,
  ]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    if (!isLoggedIn) {
      setIsLoading(false);
      setMessages([]);
      setPreview(null);
      setDiff(null);
      setPipelineState(null);
      setNextActions([]);
      setQuickReplies([]);
      setSessionId(null);
      setSessions([]);
      setIsReadOnly(false);
      setSessionResumed(false);
      setParsedSections(null);
    setDocumentId(null);
      return;
    }
    setMessages([]);
    setPreview(null);
    setDiff(null);
    setPipelineState(null);
    setNextActions([]);
    setQuickReplies([]);
    setSessionId(null);
    setError(null);
    setNeedsOnboarding(false);
    setNeedsProfile(false);
    setIsReadOnly(false);
    setSessionResumed(false);
    setParsedSections(null);
    setDocumentId(null);
    void startSession();
  }, [enabled, isLoggedIn, jobId, startSession]);

  const selectSession = useCallback(
    async (sid: string) => {
      if (!enabled || !isLoggedIn || sid === sessionId) return;
      const gen = ++activateGenRef.current;
      beginSessionOpen();
      setError(null);
      setSessionId(sid);
      setMessages([]);
      setPreview(null);
      setDiff(null);
      setPipelineState(null);
      setNextActions([]);
      setQuickReplies([]);
      setParsedSections(null);
      setDocumentId(null);

      const entry = sessions.find((s) => s.session_id === sid);
      setIsReadOnly(isAgentSessionReadOnly(entry?.status));
      setSessionResumed(false);

      await loadSessionMessages(sid, gen);
      const openGreeting = await syncOpenMeta(gen);
      if (gen !== activateGenRef.current) return;
      applyEmptySessionGreeting(openGreeting);
      finishSessionLoad(gen);
    },
    [
      applyEmptySessionGreeting,
      beginSessionOpen,
      enabled,
      finishSessionLoad,
      isLoggedIn,
      loadSessionMessages,
      sessionId,
      sessions,
      syncOpenMeta,
    ]
  );

  const applyOpenedSession = useCallback(
    async (data: ActivateAgentResponse) => {
      const gen = ++activateGenRef.current;
      beginSessionOpen();
      setError(null);
      setNeedsOnboarding(false);
      setNeedsProfile(false);
      setIsReadOnly(false);
      setSessionResumed(false);
      setMessages([]);
      setPreview(null);
      setDiff(null);
      setPipelineState(null);
      setNextActions([]);
      setQuickReplies([]);
      setParsedSections(null);
      setDocumentId(null);

      const { session_id, greeting, resumed } = data;
      setSessionId(session_id);
      setSessionResumed(Boolean(resumed));
      publishActiveAgentSync({
        type: 'activated',
        agentId: CV_BUILDER_AGENT_ID,
        sessionId: session_id,
      });

      if (resumed) {
        await loadSessionMessages(session_id, gen);
        applyActivateResponse(data);
        applyEmptySessionGreeting(greeting);
      } else {
        applyActivateResponse(data);
        applyEmptySessionGreeting(greeting);
      }
      finishSessionLoad(gen);
      void refreshSessions();
    },
    [
      applyActivateResponse,
      applyEmptySessionGreeting,
      beginSessionOpen,
      finishSessionLoad,
      loadSessionMessages,
      refreshSessions,
    ]
  );

  const selectSessionRef = useRef(selectSession);
  const applyOpenedSessionRef = useRef(applyOpenedSession);

  useEffect(() => {
    selectSessionRef.current = selectSession;
  }, [selectSession]);

  useEffect(() => {
    applyOpenedSessionRef.current = applyOpenedSession;
  }, [applyOpenedSession]);

  useEffect(() => {
    if (!enabled) return;

    const onSelectHistory = (event: Event) => {
      const detail = (event as CustomEvent<SessionNavSelectHistoryDetail>).detail;
      if (detail.agentId !== CV_BUILDER_AGENT_ID) return;
      void selectSessionRef.current(detail.sessionId);
    };

    const onSessionOpened = (event: Event) => {
      const detail = (event as CustomEvent<SessionNavSessionOpenedDetail>).detail;
      if (detail.agentId !== CV_BUILDER_AGENT_ID) return;
      void applyOpenedSessionRef.current(detail.data);
    };

    const onSessionExited = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId: string }>).detail;
      if (detail.agentId !== CV_BUILDER_AGENT_ID) return;
      activateGenRef.current += 1;
      setMessages([]);
      setPreview(null);
      setDiff(null);
      setPipelineState(null);
      setNextActions([]);
      setQuickReplies([]);
      setSessionId(null);
      setIsReadOnly(false);
      setSessionResumed(false);
      setParsedSections(null);
      setDocumentId(null);
      setError(null);
      setNeedsOnboarding(false);
      setNeedsProfile(false);
      setIsLoading(false);
      setIsSending(false);
    };

    window.addEventListener(SESSION_NAV_SELECT_HISTORY_EVENT, onSelectHistory);
    window.addEventListener(SESSION_NAV_SESSION_OPENED_EVENT, onSessionOpened);
    window.addEventListener(SESSION_NAV_SESSION_EXITED_EVENT, onSessionExited);
    return () => {
      window.removeEventListener(SESSION_NAV_SELECT_HISTORY_EVENT, onSelectHistory);
      window.removeEventListener(SESSION_NAV_SESSION_OPENED_EVENT, onSessionOpened);
      window.removeEventListener(SESSION_NAV_SESSION_EXITED_EVENT, onSessionExited);
    };
  }, [enabled]);

  const sendAgentMessage = useCallback(
    async (
      text: string,
      options?: { showUserBubble?: boolean }
    ): Promise<CvAgentSendResult> => {
      if (!text.trim() || isSending || !enabled || !sessionId || isReadOnly) {
        return { ok: false as const };
      }
      const ctaSnapshot = { nextActions: [] as ChatNextAction[], quickReplies: [] as string[] };
      setIsSending(true);
      setError(null);
      setNextActions((prev) => {
        ctaSnapshot.nextActions = prev;
        return [];
      });
      setQuickReplies((prev) => {
        ctaSnapshot.quickReplies = prev;
        return [];
      });
      if (options?.showUserBubble !== false) {
        setMessages((prev) => [
          ...prev,
          { id: nextId('user'), role: 'user', content: text.trim() },
        ]);
      }
      const res = await sendAgentChat(CV_BUILDER_AGENT_ID, text.trim(), sessionId);
      if (!res.success || !res.data) {
        setNextActions(ctaSnapshot.nextActions);
        setQuickReplies(ctaSnapshot.quickReplies);
        if (res.errorCode === 'ONBOARDING_INCOMPLETE') {
          setNeedsOnboarding(true);
        } else if (isAgentBlocked(res)) {
          setNeedsProfile(true);
        } else if (isPaywallError(res) && res.errorCode) {
          openPaywall(res.errorCode);
        } else {
          showToast(res.error ?? 'Failed to send message', 'error');
        }
        setIsSending(false);
        return { ok: false as const, error: res.error };
      }

      const escalation = parseAgentEscalation(res.data);
      if (escalation) {
        setEscalationRecoveryTarget(null);
        setIsReadOnly(true);
        showToast(t('escalationSwitching'), 'info');

        const follow = await followAgentEscalation(escalation, {
          activateAgentWithoutPrecheck,
        });

        if (!follow.ok) {
          applyResponse(res.data);
          setIsSending(false);
          showToast(follow.error ?? t('escalationFailed'), 'error');
          return { ok: false as const, error: follow.error };
        }

        const plan = planNavigation(locale, 'cv', escalation.targetAgentId);
        if (isNavigationPending(plan)) {
          setEscalationRecoveryTarget(escalation.targetAgentId);
        }
        setIsSending(false);
        return { ok: true as const, escalated: true as const };
      }

      applyResponse(res.data);
      setIsSending(false);
      void refreshSessions();
      return { ok: true as const };
    },
    [
      activateAgentWithoutPrecheck,
      applyResponse,
      enabled,
      isReadOnly,
      isSending,
      locale,
      openPaywall,
      refreshSessions,
      sessionId,
      showToast,
      t,
    ]
  );

  const continueEscalationRecovery = useCallback(() => {
    if (!escalationRecoveryTarget) return;
    const plan = planNavigation(locale, 'cv', escalationRecoveryTarget);
    if (isNavigationPending(plan) && plan.href) {
      router.replace(plan.href);
    }
  }, [escalationRecoveryTarget, locale, router]);

  const sendMessage = useCallback(
    (text: string): Promise<CvAgentSendResult> => sendAgentMessage(text),
    [sendAgentMessage]
  );

  const intakeConfirm = useCallback(
    () => sendAgentMessage('__action:confirm', { showUserBubble: false }),
    [sendAgentMessage]
  );

  const acceptCv = useCallback(async () => {
    const result = await sendAgentMessage('__action:accept_cv', {
      showUserBubble: false,
    });
    if (result.ok) {
      publishWorkspaceAssetsInvalidate();
    }
    return result;
  }, [sendAgentMessage]);

  const confirmCv = acceptCv;

  const regenerateCv = useCallback(
    () => sendAgentMessage('__action:regenerate', { showUserBubble: false }),
    [sendAgentMessage]
  );

  const exportCvPdf = useCallback(async () => {
    // isSwitchingTemplate: review on kazispace-ai#222 — a template switch in
    // flight invalidates the doc's cached PDF server-side, so starting an
    // export at the same time would race that invalidation. Unreachable via
    // the UI (CvPreviewPane's isExportingAny already disables this button
    // while switching) but the hook-level guard should hold on its own too.
    if (!enabled || !isLoggedIn || isSending || isExporting || isExportingDocx || isSwitchingTemplate) {
      return { ok: false as const };
    }

    if (!documentId) {
      return sendAgentMessage('__action:export', { showUserBubble: false });
    }

    setIsExporting(true);
    try {
      const res = await exportCvDocumentPdf(documentId, locale);
      if (!res.success) {
        showToast(resolveCvExportErrorMessage(res.error, res.errorCode, t), 'error');
        return { ok: false as const, error: res.error };
      }
      publishWorkspaceAssetsInvalidate();
      return { ok: true as const };
    } finally {
      setIsExporting(false);
    }
  }, [
    documentId,
    enabled,
    isExporting,
    isExportingDocx,
    isLoggedIn,
    isSending,
    isSwitchingTemplate,
    locale,
    sendAgentMessage,
    showToast,
    t,
  ]);

  /** KAZI-845: parallels exportCvPdf — backend only surfaces this CTA (`resume` non-empty). */
  const canExportDocx = useMemo(
    () => nextActions.some((action) => action.type === 'export_docx'),
    [nextActions]
  );

  const exportCvDocx = useCallback(async () => {
    // isSwitchingTemplate: same reasoning as exportCvPdf above.
    if (!enabled || !isLoggedIn || isSending || isExporting || isExportingDocx || isSwitchingTemplate) {
      return { ok: false as const };
    }

    if (!documentId) {
      return sendAgentMessage('__action:export_docx', { showUserBubble: false });
    }

    setIsExportingDocx(true);
    try {
      const res = await exportCvDocumentDocx(documentId, locale);
      if (!res.success) {
        showToast(resolveCvExportErrorMessage(res.error, res.errorCode, t, 'docx'), 'error');
        return { ok: false as const, error: res.error };
      }
      publishWorkspaceAssetsInvalidate();
      return { ok: true as const };
    } finally {
      setIsExportingDocx(false);
    }
  }, [
    documentId,
    enabled,
    isExporting,
    isExportingDocx,
    isLoggedIn,
    isSending,
    isSwitchingTemplate,
    locale,
    sendAgentMessage,
    showToast,
    t,
  ]);

  /**
   * KAZI-848 "换一个" — the CV template is auto-selected server-side from
   * target_role at generation time; this is the user's lightweight local
   * override (cycles to the next template in the same style bucket, zero
   * additional LLM calls). Not a template browser — that direction was
   * explicitly rejected in favor of auto-select + this one override.
   */
  const switchTemplate = useCallback(async () => {
    if (!enabled || !isLoggedIn || isSending || isExporting || isExportingDocx || isSwitchingTemplate) {
      return { ok: false as const };
    }
    if (!documentId) {
      return { ok: false as const };
    }

    setIsSwitchingTemplate(true);
    try {
      const res = await switchCvDocumentTemplate(documentId, locale);
      if (!res.success) {
        showToast(t('switchTemplateError'), 'error');
        return { ok: false as const, error: res.error };
      }
      return { ok: true as const };
    } finally {
      setIsSwitchingTemplate(false);
    }
  }, [
    documentId,
    enabled,
    isExporting,
    isExportingDocx,
    isLoggedIn,
    isSending,
    isSwitchingTemplate,
    locale,
    showToast,
    t,
  ]);

  const uploadResume = useCallback(
    async (file: File) => {
      if (!enabled || !isLoggedIn || !sessionId || isReadOnly || isSending || isUploading) {
        return { ok: false as const };
      }

      setIsUploading(true);
      setError(null);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId('user'),
          role: 'user',
          content: `📎 ${file.name}`,
        },
      ]);

      const res = await uploadCvResumeFile(file, locale);
      if (!res.success || !res.data) {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role === 'user' && last.content === `📎 ${file.name}`) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        showToast(resolveCvUploadErrorMessage(res.error, res.errorCode, t), 'error');
        setIsUploading(false);
        return { ok: false as const, error: res.error };
      }

      const agentPayload: AgentChatResponse = {
        agent_id: res.data.agent_id,
        response: res.data.response,
        meta: res.data.response.meta,
      };
      applyResponse(agentPayload);
      void refreshSessions();
      setIsUploading(false);
      return { ok: true as const };
    },
    [
      applyResponse,
      enabled,
      isLoggedIn,
      isReadOnly,
      isSending,
      isUploading,
      locale,
      refreshSessions,
      sessionId,
      showToast,
      t,
    ]
  );

  const restartSession = useCallback(async () => {
    if (!enabled || !isLoggedIn || isSending || isLoading) return;
    const gen = ++activateGenRef.current;
    beginSessionOpen();
    setError(null);
    setIsReadOnly(false);
    setSessionResumed(false);

    try {
      setNeedsOnboarding(false);
      setNeedsProfile(false);
      setMessages([]);
      setPreview(null);
      setDiff(null);
      setPipelineState(null);
      setNextActions([]);
      setQuickReplies([]);
      setSessionId(null);
      setParsedSections(null);
    setDocumentId(null);

      const deact = await deactivateToClinic(locale, {
        agentId: CV_BUILDER_AGENT_ID,
        skipBroadcast: true,
      });
      if (gen !== activateGenRef.current) return;
      if (!deact.ok) {
        showToast(deact.error ?? 'Failed to reset CV session', 'error');
        return;
      }

      const res = await activateAgent(CV_BUILDER_AGENT_ID, locale, undefined, {
        job_id: jobId ?? undefined,
        force_new_session: true,
      });
      if (gen !== activateGenRef.current) return;

      if (!res.success || !res.data) {
        handleApiError(res);
        return;
      }

      const { session_id, greeting } = res.data;
      setSessionId(session_id);
      applyEmptySessionGreeting(greeting);
      publishActiveAgentSync({
        type: 'activated',
        agentId: CV_BUILDER_AGENT_ID,
        sessionId: session_id,
      });
      applyActivateResponse(res.data);
      void refreshSessions();
    } finally {
      finishSessionLoad(gen);
    }
  }, [
    applyActivateResponse,
    applyEmptySessionGreeting,
    beginSessionOpen,
    enabled,
    finishSessionLoad,
    handleApiError,
    isLoading,
    isLoggedIn,
    isSending,
    jobId,
    locale,
    refreshSessions,
    showToast,
  ]);

  const isSessionReady =
    !!sessionId &&
    !isLoading &&
    !needsProfile &&
    !needsOnboarding &&
    !error &&
    !isReadOnly &&
    !isUploading &&
    !isExporting &&
    !isExportingDocx &&
    !isSwitchingTemplate;

  const activeWorkflow = useMemo(
    () =>
      resolveWorkflowFromMessages(messages, () =>
        buildCvWorkflowFromPipeline(pipelineState, cvWorkflowLabels)
      ),
    [cvWorkflowLabels, messages, pipelineState]
  );

  return {
    messages,
    preview,
    diff,
    pipelineState,
    activeWorkflow,
    nextActions,
    quickReplies,
    parsedSections,
    documentId,
    sessions,
    sessionsLoading,
    sessionId,
    isLoading,
    isOpening,
    isSending,
    isUploading,
    isExporting,
    isExportingDocx,
    isSwitchingTemplate,
    canExportDocx,
    error,
    needsLogin: !isLoggedIn,
    needsOnboarding,
    needsProfile,
    isSessionReady,
    isReadOnly,
    sessionResumed,
    escalationRecoveryTarget,
    continueEscalationRecovery,
    sendMessage,
    sendPayload: sendAgentMessage,
    intakeConfirm,
    acceptCv,
    confirmCv,
    regenerateCv,
    exportCvPdf,
    exportCvDocx,
    switchTemplate,
    uploadResume,
    selectSession,
    refreshSessions,
    resyncSession,
    restart: restartSession,
  };
}
