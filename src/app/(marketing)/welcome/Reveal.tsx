"use client";

import { useEffect } from "react";

/**
 * The marketing page's one client island.
 *
 * Four jobs, all of them decoration: stagger each section's parts as it scrolls
 * into view, raise the nav once the page leaves the top, and give the hero
 * panel a parallax that answers the pointer.
 *
 * The hidden start state is plain CSS in the server-rendered stylesheet, not
 * something stamped onto the document by a script. An earlier version set an
 * attribute on <html> before paint — the usual trick — and it produced a
 * hydration mismatch, because React compares the attributes it rendered against
 * the ones it finds. Nothing here touches an element React owns: the nav flag
 * goes on the nav's own classList and the stagger indices go on children of a
 * container React renders empty of them.
 *
 * Three ways this could hide the page instead of decorating it, all answered
 * without JavaScript: reduced motion and print override the start state in CSS,
 * no-JS overrides it with a <noscript> style, and a hydration that never happens
 * is caught by the failsafe in page.tsx, which watches for the flag set below.
 */

/** How far the panel and the chips may deflect. Past this it stops being a
 *  product shot and becomes a mockup on a design site. */
const TILT_Y = 5;
const TILT_X = -4;
const PANEL_SHIFT = 8;
const CHIP_SHIFT = -22;

export default function Reveal() {
  useEffect(() => {
    // Tells the failsafe that someone is home, so it stands down.
    (window as unknown as { __mkReveal?: boolean }).__mkReveal = true;

    const cleanups: (() => void)[] = [];
    // Read live rather than snapshotting: people turn this on mid-session.
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)");

    // ── The nav lifts off the hero ────────────────────────────────────────
    // A sentinel rather than a scroll handler: no listener, no throttling, and
    // nothing running on frames where the boundary has not been crossed.
    const nav = document.querySelector(".mk-nav");
    const sentinel = document.querySelector(".mk-nav-sentinel");
    if (nav && sentinel) {
      const io = new IntersectionObserver(
        ([e]) => nav.classList.toggle("is-stuck", !e.isIntersecting),
        { threshold: 0 },
      );
      io.observe(sentinel);
      cleanups.push(() => io.disconnect());
    }

    // ── Stagger indices, derived rather than hand-written ─────────────────
    // Capped at six slots: past that the last card in a grid has been sitting
    // fully visible and transparent for half a second, which is the tell.
    document.querySelectorAll<HTMLElement>("[data-reveal-group]").forEach((group) => {
      const cols = Number(group.dataset.revealCols || 1);
      Array.from(group.children).forEach((child, i) => {
        const el = child as HTMLElement;
        el.setAttribute("data-reveal", "");
        el.style.setProperty("--i", String(Math.min(Math.floor(i / cols), 5)));
      });
    });

    // ── Section entrances ─────────────────────────────────────────────────
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"));
    } else {
      // -12% rather than a visibility threshold: the reveal exists to avoid a
      // pop-in, not to be watched. It should be finished before the reader's
      // eye arrives.
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            // `top < 0` means the element is already above the viewport. A fast
            // scroll — a flick, End, an anchor jump — can carry a section past
            // the observer between two ticks, and without this it would stay
            // invisible for the rest of the session. Caught in testing: two
            // headings in "What's inside" never came back.
            if (!entry.isIntersecting && entry.boundingClientRect.top > 0) continue;
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0 },
      );
      els.forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    }

    // ── Which section you are in ──────────────────────────────────────────
    // A band across the middle of the viewport: whichever section is crossing
    // it owns the nav. Watching for "any part visible" instead would light two
    // links at once on every boundary.
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".mk-nav-links a"));
    const sections = links
      .map((a) => document.querySelector(a.getAttribute("href") ?? ""))
      .filter((el): el is Element => !!el);
    if (sections.length) {
      const seen = new Set<Element>();
      const spy = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) seen.add(e.target);
            else seen.delete(e.target);
          }
          // Document order, so scrolling up lands on the earlier section
          // rather than whichever one happened to fire last.
          const on = sections.find((sec) => seen.has(sec));
          for (const a of links) {
            const href = a.getAttribute("href") ?? "";
            const mine = on ? `#${on.id}` === href : false;
            if (mine) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
          }
        },
        { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
      );
      sections.forEach((sec) => spy.observe(sec));
      cleanups.push(() => spy.disconnect());
    }

    // ── The phone CTA bar ─────────────────────────────────────────────────
    // Shown once the hero's own buttons have left. Same sentinel trick as the
    // nav: no scroll handler, and nothing runs on frames where nothing changed.
    const bar = document.querySelector<HTMLElement>("[data-mk-bar]");
    const heroCta = document.querySelector(".mk-hero-cta");
    if (bar && heroCta) {
      const io = new IntersectionObserver(
        ([e]) => bar.classList.toggle("is-up", !e.isIntersecting && e.boundingClientRect.top < 0),
        { threshold: 0 },
      );
      io.observe(heroCta);
      cleanups.push(() => io.disconnect());
    }

    // ── Pointer parallax on the hero panel ────────────────────────────────
    const hero = document.querySelector<HTMLElement>(".mk-hero");
    const tilt = document.querySelector<HTMLElement>(".mk-board-tilt");
    const chips = Array.from(document.querySelectorAll<HTMLElement>(".mk-float"));

    let bound = false;
    let raf = 0;
    let px = 0;
    let py = 0;

    const write = () => {
      raf = 0;
      if (!tilt) return;
      tilt.style.transform =
        `rotateY(${px * TILT_Y}deg) rotateX(${py * TILT_X}deg) ` +
        `translate3d(${px * PANEL_SHIFT}px, ${py * (PANEL_SHIFT * 0.75)}px, 0)`;
      // Chips deflect further and in the opposite direction — that is what
      // makes it a parallax rather than a tilt: the nearer layer moves more.
      chips.forEach((c, i) => {
        const depth = 1 + i * 0.15;
        c.style.transform =
          `translate3d(${px * CHIP_SHIFT * depth}px, ${py * (CHIP_SHIFT * 0.73) * depth}px, 0)`;
      });
    };

    // Pointer events outpace frames on a high-refresh mouse, so coalesce.
    const onMove = (e: PointerEvent) => {
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5;
      py = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(write);
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      write();
    };

    const unbind = () => {
      if (!bound || !hero) return;
      bound = false;
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      onLeave();
    };
    const bind = () => {
      if (bound || !hero || !tilt) return;
      if (calm?.matches || !fine?.matches) return;
      bound = true;
      hero.addEventListener("pointermove", onMove, { passive: true });
      hero.addEventListener("pointerleave", onLeave);
    };

    // 900ms: the entrance has settled, so the two never write transform at the
    // same time on elements that share an ancestor.
    const armed = window.setTimeout(bind, 900);
    cleanups.push(() => {
      window.clearTimeout(armed);
      unbind();
      if (raf) cancelAnimationFrame(raf);
    });

    const onCalmChange = () => (calm?.matches ? unbind() : bind());
    calm?.addEventListener("change", onCalmChange);
    cleanups.push(() => calm?.removeEventListener("change", onCalmChange));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
