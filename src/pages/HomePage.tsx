import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Navigation,
  User,
  Store,
  LogOut,
  ArrowRight,
  TrendingUp,
  ChevronRight,
  Shield,
  GraduationCap,
  Radio,
  VolumeX,
  PhoneCall,
  Video,
  Megaphone,
  Flame,
  Building2,
  CalendarDays,
} from 'lucide-react';
import { supabase, type Exhibition, type Store as StoreType, type NavigationNode } from '../lib/supabase';
import { extractBlocksFromNodes, matchStoreToBlock, parseBlockAndFloor, type BlockEntity } from '../utils/blocks';
import { useAuth } from '../contexts/AuthContext';
import { GPSPermissionBanner } from '../components/GPSPermissionBanner';
import { useLiveBroadcast } from '../contexts/LiveBroadcastContext';
import invexLogo from '../pics/logo.png';
import { SiteFooter } from '../components/SiteFooter';
import { EmergencyContactsModal } from '../components/EmergencyContactsModal';
import { VideoLivesModal } from '../components/VideoLivesModal';
import { EventBannerCarousel } from '../components/EventBannerCarousel';

// ═══════════════════════════════════════════════════════════════════════════════
// ⏱️ TIMING CONFIGURATION: INTRO SPLASH & HOME FADE-IN DELAY
// ═══════════════════════════════════════════════════════════════════════════════
// Change this value (in milliseconds) to adjust how long the home screen waits
// for the opening intro to finish before starting its fade-in animation.
//
// 👉 YOU CAN CHANGE THIS TIME HERE:
//    • 4500 = 4.5 seconds (starts fade-in as opening intro begins dissolving)
//    • 5000 = 5.0 seconds (starts fade-in after opening intro has dissolved)
//    • 0    = Instant (fade-in immediately without waiting for intro)
// ═══════════════════════════════════════════════════════════════════════════════
export const HOME_INTRO_FADE_DELAY_MS = 3900;

function useCarouselScroller(speed = 0.65, repeatCount = 6) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const isInteractingRef = useRef(false);
  const isMomentumRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const isWindowScrollingRef = useRef(false);
  const isVisibleRef = useRef(false);
  const isLoopRunningRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const scrollStartRef = useRef(0);
  const posRef = useRef(0);
  const singleSetWidthRef = useRef(0);
  const directionLockedRef = useRef<'horizontal' | 'vertical' | null>(null);
  const lastPointerXRef = useRef(0);
  const lastPointerTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const momentumRafIdRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  const repeatCountRef = useRef(repeatCount);
  useEffect(() => {
    repeatCountRef.current = repeatCount;
    const el = containerRef.current;
    if (el && el.scrollWidth > 0) {
      const rCount = Math.max(repeatCount, 1);
      const sWidth = el.scrollWidth / rCount;
      singleSetWidthRef.current = sWidth;
      const midPoint = Math.floor(rCount / 2) * sWidth;
      if (sWidth > 0 && Math.abs(el.scrollLeft - midPoint) > sWidth * 2) {
        let p = el.scrollLeft;
        while (p >= midPoint + sWidth) p -= sWidth;
        while (p < midPoint) p += sWidth;
        el.scrollLeft = p;
        posRef.current = p;
      }
    }
  }, [repeatCount]);

  // Pause carousel calculations while the user is actively scrolling the page vertically
  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onWindowScroll = () => {
      isWindowScrollingRef.current = true;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        isWindowScrollingRef.current = false;
        const el = containerRef.current;
        if (el) posRef.current = el.scrollLeft;
      }, 200);
    };

    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onWindowScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, []);

  // Measure singleSetWidth and initialize in middle safe zone so users can immediately sweep left-to-right AND right-to-left
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measureWidth = () => {
      if (el.scrollWidth > 0) {
        const rCount = Math.max(repeatCountRef.current, 1);
        const sWidth = el.scrollWidth / rCount;
        singleSetWidthRef.current = sWidth;
        const midPoint = Math.floor(rCount / 2) * sWidth;
        if (sWidth > 0) {
          if (!isInitializedRef.current) {
            el.scrollLeft = midPoint;
            posRef.current = midPoint;
            isInitializedRef.current = true;
          } else if (Math.abs(el.scrollLeft - midPoint) > sWidth * 2) {
            let p = el.scrollLeft;
            while (p >= midPoint + sWidth) p -= sWidth;
            while (p < midPoint) p += sWidth;
            el.scrollLeft = p;
            posRef.current = p;
          }
        }
      }
    };

    // Initial check
    measureWidth();
    const initTimer = setTimeout(measureWidth, 150);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        measureWidth();
      });
      ro.observe(el);
    }

    return () => {
      clearTimeout(initTimer);
      ro?.disconnect();
    };
  }, []);

  const pauseAndResume = useCallback((delay = 2000) => {
    isInteractingRef.current = true;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
      const el = containerRef.current;
      if (el) {
        posRef.current = el.scrollLeft;
      }
    }, delay);
  }, []);

  const stopMomentum = useCallback(() => {
    if (momentumRafIdRef.current) {
      cancelAnimationFrame(momentumRafIdRef.current);
      momentumRafIdRef.current = null;
    }
    isMomentumRef.current = false;
  }, []);

  // Smooth momentum gliding after finger sweep / flick
  const startMomentum = useCallback((initialVelocity: number) => {
    stopMomentum();
    const el = containerRef.current;
    if (!el) return;

    // Cap velocity to avoid chaotic spinning on low-end hardware
    let frameVelocity = -initialVelocity * 15;
    const maxV = 18;
    frameVelocity = Math.max(-maxV, Math.min(maxV, frameVelocity));

    if (Math.abs(frameVelocity) < 0.6) {
      pauseAndResume(1200);
      return;
    }

    isMomentumRef.current = true;
    isInteractingRef.current = true;

    const glide = () => {
      const sWidth = singleSetWidthRef.current;
      const rCount = repeatCountRef.current;
      frameVelocity *= 0.93; // Smooth natural friction

      if (Math.abs(frameVelocity) < 0.2 || !isMomentumRef.current) {
        stopMomentum();
        pauseAndResume(1500);
        return;
      }

      posRef.current += frameVelocity;

      if (sWidth > 0 && rCount > 1) {
        const midPoint = Math.floor(rCount / 2) * sWidth;
        while (posRef.current >= midPoint + sWidth) {
          posRef.current -= sWidth;
        }
        while (posRef.current < midPoint) {
          posRef.current += sWidth;
        }
      }

      el.scrollLeft = posRef.current;
      momentumRafIdRef.current = requestAnimationFrame(glide);
    };

    momentumRafIdRef.current = requestAnimationFrame(glide);
  }, [pauseAndResume, stopMomentum]);

  // Main gentle auto-scroll loop (stops RAF when offscreen to save battery and CPU)
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (!isVisibleRef.current) {
        isLoopRunningRef.current = false;
        return;
      }

      const delta = Math.min((currentTime - lastTime) / 16.67, 3);
      lastTime = currentTime;

      const currentEl = containerRef.current;
      if (
        currentEl &&
        !isWindowScrollingRef.current &&
        !isInteractingRef.current &&
        !isDraggingRef.current &&
        !isMomentumRef.current
      ) {
        posRef.current += speed * delta;
        const sWidth = singleSetWidthRef.current;
        const rCount = repeatCountRef.current;

        if (sWidth > 0 && rCount > 1) {
          const midPoint = Math.floor(rCount / 2) * sWidth;
          while (posRef.current >= midPoint + sWidth) {
            posRef.current -= sWidth;
          }
          while (posRef.current < midPoint) {
            posRef.current += sWidth;
          }
        }

        currentEl.scrollLeft = posRef.current;
      } else if (isDraggingRef.current && currentEl) {
        posRef.current = currentEl.scrollLeft;
      }

      animId = requestAnimationFrame(loop);
    };

    const el = containerRef.current;
    let observer: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => {
          isVisibleRef.current = entry.isIntersecting;
          if (entry.isIntersecting) {
            if (el) posRef.current = el.scrollLeft;
            lastTime = performance.now();
            if (!isLoopRunningRef.current) {
              isLoopRunningRef.current = true;
              animId = requestAnimationFrame(loop);
            }
          }
        },
        { threshold: 0 }
      );
      observer.observe(el);
    } else {
      isVisibleRef.current = true;
      isLoopRunningRef.current = true;
      animId = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(animId);
      isLoopRunningRef.current = false;
      stopMomentum();
      observer?.disconnect();
    };
  }, [speed, stopMomentum]);

  const scroll = useCallback((direction: 'left' | 'right') => {
    stopMomentum();
    pauseAndResume(3500);
    const el = containerRef.current;
    if (!el) return;
    const sWidth = singleSetWidthRef.current;
    const rCount = repeatCountRef.current;
    const distance = Math.max(el.clientWidth * 0.7, 260);

    let target = el.scrollLeft + (direction === 'left' ? -distance : distance);

    if (sWidth > 0 && rCount > 1) {
      const midPoint = Math.floor(rCount / 2) * sWidth;
      while (target >= midPoint + sWidth * 2) target -= sWidth;
      while (target < midPoint - sWidth) target += sWidth;
    }

    el.scrollTo({
      left: target,
      behavior: 'smooth',
    });

    setTimeout(() => {
      if (el && sWidth > 0 && rCount > 1) {
        const midPoint = Math.floor(rCount / 2) * sWidth;
        let cur = el.scrollLeft;
        while (cur >= midPoint + sWidth) cur -= sWidth;
        while (cur < midPoint) cur += sWidth;
        el.scrollLeft = cur;
        posRef.current = cur;
      }
    }, 450);
  }, [pauseAndResume, stopMomentum]);

  // Mouse handlers for desktop click-and-drag
  const onMouseDown = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el || e.button !== 0) return;
    stopMomentum();
    isDraggingRef.current = true;
    isInteractingRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.pageX;
    scrollStartRef.current = el.scrollLeft;
    lastPointerXRef.current = e.pageX;
    lastPointerTimeRef.current = performance.now();
    velocityRef.current = 0;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const deltaX = e.pageX - startXRef.current;
    if (Math.abs(deltaX) > 4) {
      hasDraggedRef.current = true;
    }
    const now = performance.now();
    const dt = now - lastPointerTimeRef.current;
    if (dt > 10) {
      const instantVelocity = (e.pageX - lastPointerXRef.current) / dt;
      velocityRef.current = instantVelocity * 0.7 + velocityRef.current * 0.3;
      lastPointerXRef.current = e.pageX;
      lastPointerTimeRef.current = now;
    }

    let targetScroll = scrollStartRef.current - deltaX;
    const sWidth = singleSetWidthRef.current;
    const rCount = repeatCountRef.current;
    if (sWidth > 0 && rCount > 1) {
      const midPoint = Math.floor(rCount / 2) * sWidth;
      while (targetScroll >= midPoint + sWidth) {
        targetScroll -= sWidth;
        scrollStartRef.current -= sWidth;
      }
      while (targetScroll < midPoint) {
        targetScroll += sWidth;
        scrollStartRef.current += sWidth;
      }
    }
    el.scrollLeft = targetScroll;
    posRef.current = targetScroll;
  };

  const onMouseUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (hasDraggedRef.current && Math.abs(velocityRef.current) > 0.12) {
      startMomentum(velocityRef.current);
    } else {
      pauseAndResume(2000);
    }
  };

  const onMouseEnter = () => {
    isInteractingRef.current = true;
  };

  const onMouseLeave = () => {
    if (isDraggingRef.current) {
      onMouseUp();
    } else {
      isInteractingRef.current = false;
    }
  };

  // Touch handlers for mobile finger sweep with direction lock & momentum
  const onTouchStart = (e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el || e.touches.length !== 1) return;
    stopMomentum();
    isDraggingRef.current = true;
    isInteractingRef.current = true;
    hasDraggedRef.current = false;
    directionLockedRef.current = null;
    const touch = e.touches[0];
    startXRef.current = touch.pageX;
    startYRef.current = touch.pageY;
    scrollStartRef.current = el.scrollLeft;
    lastPointerXRef.current = touch.pageX;
    lastPointerTimeRef.current = performance.now();
    velocityRef.current = 0;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const el = containerRef.current;
    if (!el || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaX = touch.pageX - startXRef.current;
    const deltaY = touch.pageY - startYRef.current;

    // Check lock direction if not set yet
    if (!directionLockedRef.current) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX > 6 || absY > 6) {
        if (absX >= absY) {
          directionLockedRef.current = 'horizontal';
        } else {
          // Vertical movement dominates: yield completely to native vertical page scroll
          directionLockedRef.current = 'vertical';
          isDraggingRef.current = false;
          pauseAndResume(400); // release interaction lock so vertical scroll isn't blocked
          return;
        }
      } else {
        return;
      }
    }

    if (directionLockedRef.current !== 'horizontal') return;

    if (Math.abs(deltaX) > 4) {
      hasDraggedRef.current = true;
    }

    const now = performance.now();
    const dt = now - lastPointerTimeRef.current;
    if (dt > 10) {
      const instantVelocity = (touch.pageX - lastPointerXRef.current) / dt;
      velocityRef.current = instantVelocity * 0.7 + velocityRef.current * 0.3;
      lastPointerXRef.current = touch.pageX;
      lastPointerTimeRef.current = now;
    }

    // 1:1 direct finger tracking with seamless infinite wrap around safe midPoint
    let targetScroll = scrollStartRef.current - deltaX;
    const sWidth = singleSetWidthRef.current;
    const rCount = repeatCountRef.current;
    if (sWidth > 0 && rCount > 1) {
      const midPoint = Math.floor(rCount / 2) * sWidth;
      while (targetScroll >= midPoint + sWidth) {
        targetScroll -= sWidth;
        scrollStartRef.current -= sWidth;
      }
      while (targetScroll < midPoint) {
        targetScroll += sWidth;
        scrollStartRef.current += sWidth;
      }
    }

    el.scrollLeft = targetScroll;
    posRef.current = targetScroll;
  };

  const onTouchEnd = () => {
    const wasHorizontal = isDraggingRef.current && directionLockedRef.current === 'horizontal';
    const hadVelocity = Math.abs(velocityRef.current) > 0.12;

    isDraggingRef.current = false;
    directionLockedRef.current = null;

    if (wasHorizontal && hasDraggedRef.current && hadVelocity) {
      startMomentum(velocityRef.current);
    } else {
      pauseAndResume(1500);
    }
  };

  const onTouchCancel = () => {
    isDraggingRef.current = false;
    directionLockedRef.current = null;
    stopMomentum();
    pauseAndResume(1000);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (hasDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      hasDraggedRef.current = false;
    }
  };

  const onWheel = () => {
    pauseAndResume(2000);
    const el = containerRef.current;
    if (!el) return;
    const sWidth = singleSetWidthRef.current;
    const rCount = repeatCountRef.current;
    if (sWidth > 0 && rCount > 1) {
      const midPoint = Math.floor(rCount / 2) * sWidth;
      if (el.scrollLeft >= midPoint + sWidth * 1.5 || el.scrollLeft <= midPoint - sWidth * 0.5) {
        let cur = el.scrollLeft;
        while (cur >= midPoint + sWidth) cur -= sWidth;
        while (cur < midPoint) cur += sWidth;
        el.scrollLeft = cur;
        posRef.current = cur;
      }
    }
  };

  return {
    ref: containerRef,
    scroll,
    handlers: {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseEnter,
      onMouseLeave,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
      onClickCapture,
      onWheel,
    },
  };
}

// ── Isolated Live Visitor Counter: Prevents full HomePage re-renders ────────
const LiveVisitorBadge = memo(function LiveVisitorBadge() {
  const [liveVisitorCount, setLiveVisitorCount] = useState(0);

  useEffect(() => {
    let animId: number;
    let fluctuationTimer: ReturnType<typeof setInterval>;
    let slotCheckTimer: ReturnType<typeof setInterval>;
    let currentLive = 0;
    let currentSlotId: string | null = '__init__';
    let cleanedUp = false;

    function getActiveSlot(slots: import('../services/appSettingsService').TimeSlot[]) {
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      return slots.find((s) => {
        const start = s.start_hour * 60 + s.start_minute;
        const end = s.end_hour * 60 + s.end_minute;
        return cur >= start && cur < end;
      }) ?? null;
    }

    function animateTo(target: number, onDone: () => void) {
      cancelAnimationFrame(animId);
      const from = currentLive;
      const duration = 1400;
      const startTime = performance.now();
      const step = (now: number) => {
        if (cleanedUp) return;
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        currentLive = Math.round(from + (target - from) * ease);
        setLiveVisitorCount(currentLive);
        if (progress < 1) { animId = requestAnimationFrame(step); }
        else { currentLive = target; onDone(); }
      };
      animId = requestAnimationFrame(step);
    }

    function startFluctuation(intervalMs: number, minVal: number) {
      clearInterval(fluctuationTimer);
      fluctuationTimer = setInterval(() => {
        if (cleanedUp) return;
        const delta = (Math.random() > 0.48 ? 1 : -1) * (Math.random() > 0.75 ? 2 : 1);
        currentLive = Math.max(minVal, currentLive + delta);
        setLiveVisitorCount(currentLive);
      }, intervalMs);
    }

    function applyCurrentSlot(
      config: import('../services/appSettingsService').LiveCounterConfig,
      realVisitors: number,
      forceAnimate = false
    ) {
      const slot = getActiveSlot(config.time_slots);
      const newSlotId = slot?.id ?? 'outside';
      if (newSlotId === currentSlotId && !forceAnimate) return;
      currentSlotId = newSlotId;

      const baseCount = slot ? slot.initial_visitor_count : config.outside_hours_count;
      const target = baseCount + realVisitors;
      const intervalMs = Math.max(5000, (slot ? slot.fluctuation_interval_sec : 60) * 1000);
      const minVal = config.outside_hours_count + realVisitors;

      clearInterval(fluctuationTimer);
      animateTo(target, () => startFluctuation(intervalMs, minVal));
    }

    async function initCounter() {
      const { fetchLiveCounterConfig } = await import('../services/appSettingsService');
      const config = await fetchLiveCounterConfig();

      let realVisitors = 0;
      try {
        const { count } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true });
        realVisitors = count ?? 0;
      } catch { /* silent */ }

      if (cleanedUp) return;

      currentSlotId = '__init__';
      applyCurrentSlot(config, realVisitors, true);

      slotCheckTimer = setInterval(() => {
        if (!cleanedUp) applyCurrentSlot(config, realVisitors);
      }, 60_000);
    }

    initCounter();

    const onConfigUpdate = async (e: Event) => {
      const newConfig = (e as CustomEvent).detail as import('../services/appSettingsService').LiveCounterConfig;
      clearInterval(slotCheckTimer);
      currentSlotId = '__init__';
      let realVisitors = 0;
      try {
        const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
        realVisitors = count ?? 0;
      } catch {
        // ignore
      }
      if (!cleanedUp) {
        applyCurrentSlot(newConfig, realVisitors, true);
        slotCheckTimer = setInterval(() => {
          if (!cleanedUp) applyCurrentSlot(newConfig, realVisitors);
        }, 60_000);
      }
    };
    window.addEventListener('live-counter-updated', onConfigUpdate);

    return () => {
      cleanedUp = true;
      cancelAnimationFrame(animId);
      clearInterval(fluctuationTimer);
      clearInterval(slotCheckTimer);
      window.removeEventListener('live-counter-updated', onConfigUpdate);
    };
  }, []);

  return (
    <div className="home-stat-chip home-stat-chip-live">
      <span className="home-live-pulse-dot" />
      <span>{liveVisitorCount} Live Visitors</span>
    </div>
  );
});

export function HomePage() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { activeBroadcast, isPlaying, handleListen, handleMute } = useLiveBroadcast();

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [analyticsEvents, setAnalyticsEvents] = useState<{ target_id: string | null; target_name: string | null; event_type: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals for new buttons
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [isVideoLivesModalOpen, setIsVideoLivesModalOpen] = useState(false);

  // Real building blocks extracted dynamically from navigation nodes
  const realBlocks: BlockEntity[] = useMemo(() => {
    return extractBlocksFromNodes(nodes);
  }, [nodes]);

  // Block & Floor location resolver for any stall
  const getStoreLocation = useCallback((st: StoreType) => {
    const matched = matchStoreToBlock(st, realBlocks);
    const parsed = parseBlockAndFloor(st.floor);
    const blockName = matched ? matched.name : (parsed.blockName || 'Campus Block');
    const floorLevel = parsed.floorLevel || 'Floor 1';
    const blockColor = matched ? matched.color : '#06b6d4';
    return { blockName, floorLevel, blockColor };
  }, [realBlocks]);

  // Extract stall number from name (e.g. "Stall 64" -> "64") or use sequential fallback
  const getStallNumber = useCallback((st: StoreType, fallbackIndex: number) => {
    if (!st.name) return String(fallbackIndex);
    const numMatch = st.name.match(/(?:stall|booth|store|#|\b)\s*#?\s*(\d+)/i);
    if (numMatch && numMatch[1]) {
      return numMatch[1];
    }
    return String(fallbackIndex);
  }, []);

  // Popular stalls ranked by views & navigation interactions
  interface PopularStallItem extends StoreType {
    rank: number;
    popularityScore: number;
  }

  const popularStalls = useMemo<PopularStallItem[]>(() => {
    if (stores.length === 0) return [];

    const eventCounts = new Map<string, number>();
    analyticsEvents.forEach((ev: any) => {
      if (ev.target_id) {
        eventCounts.set(ev.target_id, (eventCounts.get(ev.target_id) || 0) + 1);
      }
      if (ev.target_name) {
        const key = ev.target_name.toLowerCase().trim();
        eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
      }
    });

    const scored = stores.map((s, idx) => {
      const idCount = eventCounts.get(s.id) || 0;
      const nameCount = eventCounts.get(s.name.toLowerCase().trim()) || 0;
      const totalScore = idCount + nameCount;
      return { store: s, score: totalScore, originalIndex: idx };
    });

    // Sort descending by score. On ties, retain stable index order
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });

    return scored.map((item, index) => ({
      ...item.store,
      rank: index + 1,
      popularityScore: item.score,
    }));
  }, [stores, analyticsEvents]);

  const popularCopies = useMemo(() => {
    const count = popularStalls.length;
    if (count === 0) return 6;
    return Math.max(6, Math.ceil(24 / count));
  }, [popularStalls.length]);

  const popularDisplayList = useMemo(() => {
    return popularStalls.length > 0 ? Array.from({ length: popularCopies }).flatMap(() => popularStalls) : [];
  }, [popularStalls, popularCopies]);

  const storeCopies = useMemo(() => {
    const count = stores.length;
    if (count === 0) return 6;
    return Math.max(6, Math.ceil(24 / count));
  }, [stores.length]);

  const storesDisplayList = useMemo(() => {
    return stores.length > 0 ? Array.from({ length: storeCopies }).flatMap(() => stores) : [];
  }, [stores, storeCopies]);

  // Interactive auto-scrolling & manually scrollable carousels with smooth momentum
  const popularCarousel = useCarouselScroller(0.65, popularCopies);
  const storesCarousel = useCarouselScroller(0.65, storeCopies);

  useEffect(() => {
    const handleUnread = (e: Event) => {
      setUnreadNotifications((e as CustomEvent).detail);
    };
    window.addEventListener('announcements-unread-count', handleUnread);
    window.dispatchEvent(new CustomEvent('request-announcements-unread-count'));

    return () => {
      window.removeEventListener('announcements-unread-count', handleUnread);
    };
  }, []);

  const handleOpenAnnouncements = () => {
    window.dispatchEvent(new CustomEvent('open-announcements-history'));
  };

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const [exhibitionsRes, storesRes, nodesRes, eventsRes] = await Promise.all([
        supabase
          .from('exhibitions')
          .select('*')
          .eq('is_active', true)
          .order('is_featured', { ascending: false })
          .order('start_date', { ascending: true }),
        supabase
          .from('stores')
          .select(`
            *,
            categories:category_id (id, name, color),
            exhibitions:exhibition_id (id, title)
          `)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('navigation_nodes')
          .select('*'),
        (async () => {
          try {
            const res = await supabase
              .from('analytics_events')
              .select('target_id, target_name, event_type');
            return res.data || [];
          } catch {
            return [];
          }
        })(),
      ]);

      setExhibitions(exhibitionsRes.data || []);
      setStores(storesRes.data || []);
      setNodes(nodesRes.data || []);
      setAnalyticsEvents(eventsRes || []);
    } catch (err) {
      console.error('Error loading homepage dashboard resources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // ── Scroll Reveal Intersection Observer ─────────────────────
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const startObserving = () => {
      if (isDisposed || observer) return;

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
              entry.target.classList.add('is-in-view');
              observer?.unobserve(entry.target);
            }
          });
        },
        {
          threshold: 0.05,
          rootMargin: '0px 0px -25px 0px',
        }
      );

      const elements = document.querySelectorAll('.scroll-reveal');
      elements.forEach((el) => {
        if (!el.classList.contains('is-in-view')) {
          observer!.observe(el);
        }
      });
    };

    // If the user clicks or presses a key to skip the intro early, start immediately
    const handleSplashExit = () => {
      if (timerId) clearTimeout(timerId);
      startObserving();
    };

    window.addEventListener('invex:splash-exit', handleSplashExit);
    window.addEventListener('invex:splash-dismissed', handleSplashExit);

    // Check if the splash overlay is currently active in the DOM
    const isSplashActive = Boolean(document.querySelector('.splash-overlay:not(.splash-exiting)'));
    const initialDelay = isSplashActive ? HOME_INTRO_FADE_DELAY_MS : 0;

    if (initialDelay > 0) {
      timerId = setTimeout(() => {
        startObserving();
      }, initialDelay);
    } else {
      const rafId = requestAnimationFrame(() => {
        startObserving();
      });
      return () => {
        isDisposed = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener('invex:splash-exit', handleSplashExit);
        window.removeEventListener('invex:splash-dismissed', handleSplashExit);
        observer?.disconnect();
      };
    }

    return () => {
      isDisposed = true;
      if (timerId) clearTimeout(timerId);
      window.removeEventListener('invex:splash-exit', handleSplashExit);
      window.removeEventListener('invex:splash-dismissed', handleSplashExit);
      observer?.disconnect();
    };
  }, [loading, exhibitions, stores]);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="home-wrapper">
      {/* Main Page Content */}
      <div className="profile-page home-enhanced" style={{ maxWidth: 880, paddingBottom: '4rem', paddingTop: '2.5rem' }}>
        <GPSPermissionBanner inFlow />

        {/* ── Centered Logo in Middle of Front Page ─────────── */}
        <div className="home-hero-center scroll-reveal">
          <img
            src={invexLogo}
            alt="INVEX 2026 Logo"
            className="home-hero-logo"
          />
        </div>

        {/* ── Hero Welcome Greeting ────────────────────────── */}
        <div className="home-welcome-banner scroll-reveal">
          <span className="home-welcome-line1">{getGreeting()},</span>
          <span className="home-welcome-line2">
            {profile?.name?.split(' ')[0] || 'Visitor'} <span className="home-welcome-wave">👋</span>
          </span>
        </div>

        {/* ── Interactive Floor Map Bar ─────────────────────── */}
        <section className="home-map-cta-enhanced scroll-reveal">
          <div className="home-map-cta-glow" />
          <div className="home-map-cta-content">
            <div className="home-map-cta-icon">
              <Navigation size={22} color="#fff" style={{ transform: 'rotate(45deg)' }} />
            </div>
            <div>
              <h2 className="home-map-cta-title">Interactive Floor Map</h2>
              <p className="home-map-cta-desc">
                Live GPS tracking · Route planning · Real-time booth locations
              </p>
            </div>
          </div>
          <Link to="/map" className="btn btn-primary home-map-cta-btn" id="home-open-map-btn">
            Open Map
            <ArrowRight size={15} />
          </Link>
          {/* 3D School button hidden from UI, preserved in codebase */}
          <Link
            to="/map3d"
            id="home-open-3d-btn"
            style={{
              display: 'none',
              alignItems: 'center', gap: '0.4rem',
              padding: '0.6rem 1.1rem', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem',
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              color: '#fff', textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(99,102,241,0.45)',
              border: 'none', whiteSpace: 'nowrap',
            }}
          >
            <GraduationCap size={16} />
            3D School
          </Link>
        </section>

        {/* ── Store Admin Panel Banner ─────────────────────────── */}
        {profile?.role === 'store_admin' && (
          <section
            id="store-admin-banner"
            className="scroll-reveal"
            style={{
              background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(168,85,247,0.15) 100%)',
              border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: 16,
              padding: '1.25rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              marginBottom: '1.25rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Store size={22} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text)' }}>
                  Store Administrator
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: 2 }}>
                  You have store management access. Design and manage your store.
                </div>
              </div>
            </div>
            <a
              href="/admin/stores"
              id="home-manage-store-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.55rem 1.1rem',
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.85rem',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
                transition: 'opacity 0.2s',
              }}
            >
              <Store size={15} />
              Manage My Store
            </a>
          </section>
        )}

        {/* ── Box Under Logo Holding Nav & Utility Items ────── */}
        <div className="home-action-box glass scroll-reveal">
          {/* Navigation Links */}
          <div className="home-action-box-links">
            {/* 1. Floor Map changed to Emergancy Contacts */}
            <button
              type="button"
              onClick={() => setIsEmergencyModalOpen(true)}
              className="home-box-link link-emergency"
              id="nav-emergency-contacts"
              title="Emergency Contacts & Hotlines"
            >
              <div className="home-box-link-icon icon-emergency">
                <PhoneCall size={22} strokeWidth={2.2} />
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Emergancy Contacts</span>
                <span className="home-box-link-desc">Hotlines</span>
              </div>
            </button>

            {/* 2. 3D Campus replaced with Broadcast */}
            <button
              type="button"
              onClick={() => {
                if (activeBroadcast) {
                  if (isPlaying) {
                    handleMute();
                  } else {
                    handleListen();
                  }
                } else {
                  handleOpenAnnouncements();
                }
              }}
              className={`home-box-link link-broadcast ${isPlaying ? 'is-playing' : ''}`}
              id="nav-broadcast"
              title={activeBroadcast ? (isPlaying ? 'Mute live voice broadcast' : 'Listen to live voice broadcast') : 'Live Voice Broadcast'}
            >
              <div className="home-box-link-icon icon-broadcast" style={{ position: 'relative' }}>
                {isPlaying ? <VolumeX size={22} strokeWidth={2.2} /> : <Radio size={22} strokeWidth={2.2} />}
                {activeBroadcast && (
                  <span
                    className="live-dot-pulse"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                    }}
                  />
                )}
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Broadcast</span>
                <span className="home-box-link-desc">
                  {isPlaying ? 'Live Audio' : activeBroadcast ? 'On Air' : 'Voice Stream'}
                </span>
              </div>
            </button>

            {/* 3. Event replaced with Video Lives */}
            <button
              type="button"
              onClick={() => setIsVideoLivesModalOpen(true)}
              className="home-box-link link-videolives"
              id="nav-video-lives"
              title="Live Video Streams (YouTube & Facebook)"
            >
              <div className="home-box-link-icon icon-videolives">
                <Video size={22} strokeWidth={2.2} />
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Video Lives</span>
                <span className="home-box-link-desc">YouTube &amp; FB</span>
              </div>
            </button>

            {/* 4. Stalls replaced with Announcement */}
            <button
              type="button"
              onClick={handleOpenAnnouncements}
              className="home-box-link link-announcements"
              id="nav-announcements"
              title="Exhibition Announcements & Alerts"
            >
              <div className="home-box-link-icon icon-announcements" style={{ position: 'relative' }}>
                <Megaphone size={22} strokeWidth={2.2} />
                {unreadNotifications > 0 && (
                  <span
                    className="notification-dot"
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                      border: '2px solid rgba(13, 16, 28, 0.9)',
                    }}
                  >
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </span>
                )}
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Announcement</span>
                <span className="home-box-link-desc">
                  {unreadNotifications > 0 ? `${unreadNotifications} Unread` : 'Live Alerts'}
                </span>
              </div>
            </button>

            {/* 5. Event option */}
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('events-banner-section');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="home-box-link link-events"
              id="nav-events"
              title="Featured Campus Events, Venues & Offers"
            >
              <div className="home-box-link-icon icon-events">
                <CalendarDays size={22} strokeWidth={2.2} />
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Event</span>
                <span className="home-box-link-desc">Venues &amp; Offers</span>
              </div>
            </button>
          </div>

          {/* User Profile / Admin controls (Search, Bell, Broadcast, and Sign In buttons hidden) */}
          {user && (
            <>
              <div className="home-action-box-divider" />
              <div className="home-action-box-bottom">
                <div className="home-action-box-buttons" style={{ justifyContent: 'center' }}>
                  <Link to="/profile" className="btn btn-ghost btn-sm navbar-action-btn" id="nav-profile-btn" title="My Profile">
                    <User size={14} />
                    <span>Profile</span>
                  </Link>
                  {profile?.role === 'admin' && (
                    <a href="/admin/" className="btn btn-ghost btn-sm navbar-admin-btn" id="nav-admin-btn" title="Admin Portal">
                      <Shield size={14} />
                      <span>Admin</span>
                    </a>
                  )}
                  <button className="btn btn-danger btn-sm navbar-signout-btn" onClick={handleSignOut} id="nav-signout-btn" title="Sign Out">
                    <LogOut size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Stats Bar ──────────────────────────────────────── */}
        <div className="home-stats-bar scroll-reveal">
          <div className="home-stat-chip">
            <TrendingUp size={14} />
            <span>{loading ? '—' : exhibitions.length} Active Events</span>
          </div>
          <div className="home-stat-divider" />
          <div className="home-stat-chip">
            <Store size={14} />
            <span>{loading ? '—' : stores.length} Stalls</span>
          </div>
          <div className="home-stat-divider" />
          <LiveVisitorBadge />
        </div>

        {/* ── Full Screen Size Width Banners for Events (Venues, Prices & Offers) ── */}
        <EventBannerCarousel events={exhibitions} loading={loading} />

        {/* ── Transition Bridge to Lower Discovery Section ─────── */}
        <div className="home-section-transition scroll-reveal">
          <div className="home-transition-beam" />
        </div>

        {/* ── Main Content Grid ───────────────────────────────── */}
        <div className="home-content-grid">

          {/* ── Popular Stalls (Most Viewed & Top-Navigated with Medals) ── */}
          <section className="home-content-block home-content-block-purple scroll-reveal">
            <div className="home-content-block-glow" />
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <div className="home-section-icon home-section-icon-purple">
                  <Flame size={18} color="#fff" />
                </div>
                <div>
                  <h2 className="home-section-title">Popular Stalls</h2>
                  <p className="home-section-sub">Most viewed &amp; top-navigated stalls on campus</p>
                </div>
              </div>
              <Link to="/stores" className="home-view-all-link" id="home-view-all-popular">
                View All <ChevronRight size={14} />
              </Link>
            </div>

            {loading ? (
              <div className="home-stores-grid">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="glass skeleton home-store-skeleton" />
                ))}
              </div>
            ) : popularStalls.length === 0 ? (
              <div className="home-empty-state">
                <Store size={32} style={{ opacity: 0.35 }} />
                <p>No stalls available yet.</p>
              </div>
            ) : (
              <div
                ref={popularCarousel.ref}
                className="home-stores-carousel-viewport"
                {...popularCarousel.handlers}
              >
                <div className="home-stores-carousel-track">
                  {popularDisplayList.map((st, index) => {
                    const loc = getStoreLocation(st);
                    const stallNum = getStallNumber(st, ((index % popularStalls.length) + 1));
                    const rank = st.rank;

                    return (
                      <Link
                        key={`pop-${st.id}-${index}`}
                        to={`/stores/${st.id}`}
                        className="home-store-carousel-card"
                        id={`home-popular-card-${st.id}-${index}`}
                        style={{
                          '--store-cat-color': st.categories?.color || loc.blockColor,
                        } as React.CSSProperties}
                      >
                        {/* 1st, 2nd, 3rd Place Medal Badge in Left Top Corner */}
                        {rank === 1 && (
                          <div className="stall-medal-badge stall-medal-gold" title="1st Place: Most Popular Stall">
                            🥇 #1
                          </div>
                        )}
                        {rank === 2 && (
                          <div className="stall-medal-badge stall-medal-silver" title="2nd Place: Top Navigated Stall">
                            🥈 #2
                          </div>
                        )}
                        {rank === 3 && (
                          <div className="stall-medal-badge stall-medal-bronze" title="3rd Place: Highly Visited Stall">
                            🥉 #3
                          </div>
                        )}
                        {rank > 3 && (
                          <div className="stall-medal-badge stall-medal-other" title={`Rank ${rank}`}>
                            #{rank}
                          </div>
                        )}

                        {/* Top-right Flame indicator */}
                        <div className="stall-popular-badge">
                          <Flame size={12} color="#f59e0b" />
                        </div>

                        {/* Store Logo */}
                        <div className="home-store-carousel-logo" style={{ marginTop: '0.35rem' }}>
                          {st.logo_url ? (
                            <img src={st.logo_url} alt={st.name} loading="lazy" decoding="async" />
                          ) : (
                            <Store size={22} color={st.categories?.color || loc.blockColor} />
                          )}
                        </div>

                        {/* Stall Number Tag */}
                        <span className="stall-number-tag">
                          Stall #{stallNum}
                        </span>

                        {/* Stall Name */}
                        <h3 className="home-store-carousel-name" title={st.name}>{st.name}</h3>

                        {/* Stall Block and Floor */}
                        <div className="stall-location-chip" style={{ color: loc.blockColor }}>
                          <Building2 size={11} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{loc.blockName}</span>
                          <span style={{ opacity: 0.5 }}>·</span>
                          <span style={{ flexShrink: 0 }}>{loc.floorLevel}</span>
                        </div>

                        {/* Category Chip */}
                        {st.categories && (
                          <span
                            className="home-store-cat-chip"
                            style={{
                              background: `${st.categories.color}20`,
                              color: st.categories.color || 'var(--color-primary-h)',
                              borderColor: `${st.categories.color}40`,
                              fontSize: '0.68rem',
                            }}
                          >
                            {st.categories.name}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ── Stalls (All Stalls with Stall Number, Block & Floor) ── */}
          <section className="home-content-block home-content-block-cyan scroll-reveal">
            <div className="home-content-block-glow" />
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <div className="home-section-icon home-section-icon-cyan">
                  <Store size={18} color="#fff" />
                </div>
                <div>
                  <h2 className="home-section-title">Stalls</h2>
                  <p className="home-section-sub">Browse all stalls with blocks &amp; floor locations</p>
                </div>
              </div>
              <Link to="/stores" className="home-view-all-link" id="home-view-all-stores">
                View All <ChevronRight size={14} />
              </Link>
            </div>

            {loading ? (
              <div className="home-stores-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="glass skeleton home-store-skeleton" />
                ))}
              </div>
            ) : stores.length === 0 ? (
              <div className="home-empty-state">
                <Store size={32} style={{ opacity: 0.35 }} />
                <p>No active stalls found.</p>
              </div>
            ) : (
              <div
                ref={storesCarousel.ref}
                className="home-stores-carousel-viewport"
                {...storesCarousel.handlers}
              >
                <div className="home-stores-carousel-track">
                  {storesDisplayList.map((st, index) => {
                    const loc = getStoreLocation(st);
                    const stallNum = getStallNumber(st, ((index % stores.length) + 1));

                    return (
                      <Link
                        key={`st-${st.id}-${index}`}
                        to={`/stores/${st.id}`}
                        className="home-store-carousel-card"
                        id={`home-store-card-${st.id}-${index}`}
                        style={{
                          '--store-cat-color': st.categories?.color || loc.blockColor,
                        } as React.CSSProperties}
                      >
                        {/* Store Logo */}
                        <div className="home-store-carousel-logo">
                          {st.logo_url ? (
                            <img src={st.logo_url} alt={st.name} loading="lazy" decoding="async" />
                          ) : (
                            <Store size={22} color={st.categories?.color || loc.blockColor} />
                          )}
                        </div>

                        {/* Stall Number Tag */}
                        <span className="stall-number-tag">
                          Stall #{stallNum}
                        </span>

                        {/* Stall Name */}
                        <h3 className="home-store-carousel-name" title={st.name}>{st.name}</h3>

                        {/* Stall Block and Floor */}
                        <div className="stall-location-chip" style={{ color: loc.blockColor }}>
                          <Building2 size={11} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{loc.blockName}</span>
                          <span style={{ opacity: 0.5 }}>·</span>
                          <span style={{ flexShrink: 0 }}>{loc.floorLevel}</span>
                        </div>

                        {/* Category Chip */}
                        {st.categories && (
                          <span
                            className="home-store-cat-chip"
                            style={{
                              background: `${st.categories.color}20`,
                              color: st.categories.color || 'var(--color-primary-h)',
                              borderColor: `${st.categories.color}40`,
                              fontSize: '0.68rem',
                            }}
                          >
                            {st.categories.name}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

        </div>
      </div>

      {/* Emergency Contacts Modal */}
      <EmergencyContactsModal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
      />

      {/* Video Lives Modal */}
      <VideoLivesModal
        isOpen={isVideoLivesModalOpen}
        onClose={() => setIsVideoLivesModalOpen(false)}
      />

      {/* Contact & Partner Information Ribbon Footer */}
      <SiteFooter />
    </div>
  );
}
