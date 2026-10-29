import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { isStaticBuild } from "./utils/staticSite";
import {
  SiteProvider,
  canEditSite,
  deepMerge,
  defaultDataFor,
  sectionData,
  useSite,
  type BenefitsData,
  type CountdownData,
  type CtaData,
  type CustomData,
  type FaqData,
  type FeaturesData,
  type GearsData,
  type HeroData,
  type JourneyData,
  type InstagramData,
  type LiveData,
  type MachineData,
  type MaintenanceData,
  type PricingData,
  type RiderKitData,
  type SectionEntry,
  type SocialProofData,
  type StoriesData,
  type YouTubeData,
} from "./store/siteContent";
import { withChildrenOn } from "./utils/cascadeRules";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import SocialProof from "./components/SocialProof";
import LiveTracker from "./components/LiveTracker";
import Features from "./components/Features";
import Showcase from "./components/Showcase";
import MachineExperience from "./components/MachineExperience";
import Gears from "./components/Gears";
import RiderKitExperience from "./components/RiderKitExperience";
import Benefits from "./components/Benefits";
import { InstagramSection, YouTubeSection } from "./components/SocialFeeds";
import Testimonials from "./components/Testimonials";
import Pricing from "./components/Pricing";
import FAQ from "./components/FAQ";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import Loader from "./components/Loader";
import SectionFrame from "./components/SectionFrame";
import CustomSection from "./components/CustomSection";
import MaintenancePage from "./components/MaintenancePage";
import CountdownSection, {
  CountdownPage,
  DonePage,
  DoneToast,
  useCountdownFinished,
} from "./components/CountdownSection";
import { EASE } from "./components/ui/motion";
import { useAnchorScroll } from "./hooks/useAnchorScroll";
import { useRouteScroll } from "./hooks/useRouteScroll";
import {
  ADMIN_PATHS,
  LIVE_MAP_PATH,
  MEMBERS_PATH,
  MEMBER_TRACKER_PATH,
  NEARBY_PATH,
  SHOP_PATH,
  memberPlaceIdFromRoute,
  useHashRoute,
} from "./utils/router";
import ShopPage from "./components/ShopPage";
import LockedSection from "./components/LockedSection";
import MembersPage from "./members/MembersPage";
import MemberTracker from "./members/MemberTracker";
import MemberPlacePage from "./members/MemberPlacePage";
import SetupWizard from "./setup/SetupWizard";
import { siteApi, type SetupStatus } from "./api/siteApi";
import { describeApiError } from "./api/client";

// Heavy routes are split out so the landing page never downloads them.
const AdminPage = lazy(() => import("./admin/AdminPage"));
const LiveMapPage = lazy(() => import("./components/LiveMapPage"));
const NearbyPlacesPage = lazy(() => import("./components/NearbyPlacesPage"));

function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950">
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
        <div className="ldr-bar h-full rounded-full bg-saffron-400" />
      </div>
    </div>
  );
}

/**
 * A section's content. Revealed sections use every child switched on, so a
 * section the countdown brings in is never empty.
 */
function dataOf<T>(entry: SectionEntry, revealed: boolean): T {
  const data = revealed ? withChildrenOn(entry) : entry.data;
  return deepMerge(defaultDataFor(entry.type), data) as T;
}

function Section({ entry, revealed = false }: { entry: SectionEntry; revealed?: boolean }) {
  const { previewAsVisitor, account } = useSite();
  // The server removes a members-only section's data for anonymous visitors,
  // so `locked` is what a visitor gets. An editor who switched on "Preview as
  // User" sees that same card, so the preview is honest: the account still has
  // the real sections, and only the deliberate preview hides them.
  const previewingAsVisitor = previewAsVisitor && canEditSite(account);
  if (entry.locked || (previewingAsVisitor && entry.membersOnly)) {
    return <LockedSection entry={entry} />;
  }
  switch (entry.type) {
    case "hero":
      return <Hero data={dataOf<HeroData>(entry, revealed)} />;
    case "socialproof":
      return <SocialProof data={dataOf<SocialProofData>(entry, revealed)} />;
    case "live":
      return <LiveTracker data={dataOf<LiveData>(entry, revealed)} />;
    case "features":
      return <Features data={dataOf<FeaturesData>(entry, revealed)} />;
    case "journey":
      return <Showcase data={dataOf<JourneyData>(entry, revealed)} />;
    case "machine":
      return <MachineExperience data={dataOf<MachineData>(entry, revealed)} />;
    case "gears":
      return <Gears data={dataOf<GearsData>(entry, revealed)} />;
    case "riderkit":
      return <RiderKitExperience data={dataOf<RiderKitData>(entry, revealed)} />;
    case "benefits":
      return <Benefits data={dataOf<BenefitsData>(entry, revealed)} />;
    case "youtube":
      return <YouTubeSection data={dataOf<YouTubeData>(entry, revealed)} />;
    case "instagram":
      return <InstagramSection data={dataOf<InstagramData>(entry, revealed)} />;
    case "stories":
      return <Testimonials data={dataOf<StoriesData>(entry, revealed)} />;
    case "pricing":
      return <Pricing data={dataOf<PricingData>(entry, revealed)} />;
    case "faq":
      return <FAQ data={dataOf<FaqData>(entry, revealed)} />;
    case "cta":
      return <CTA data={dataOf<CtaData>(entry, revealed)} />;
    case "countdown":
      return <CountdownSection data={dataOf<CountdownData>(entry, false)} />;
    case "custom": {
      const d = entry.data as Partial<CustomData>;
      return (
        <CustomSection
          entry={entry}
          data={{
            eyebrow: d.eyebrow ?? "",
            title: d.title ?? "",
            sub: d.sub ?? "",
            image: d.image ?? "",
            imageAlt: d.imageAlt ?? "",
            buttonLabel: d.buttonLabel ?? "",
            buttonHref: d.buttonHref ?? "",
            layout: d.layout === "image-left" ? "image-left" : "image-right",
          }}
        />
      );
    }
    default:
      return null;
  }
}

function LandingPage() {
  // `content` decides what the page *is* (countdown taking over, maintenance,
  // which sections exist for visitors); `live` is what gets painted — for a
  // signed-in editor that is the draft, so an on-site edit shows up at once.
  const { content, live } = useSite();

  // ── Countdown state (hooks first; the early returns below depend on them) ──
  const countdownEntry = content.sections.find((s) => s.type === "countdown");
  const countdownOn = Boolean(countdownEntry?.enabled);
  const cd = sectionData<CountdownData>(content, "countdown");
  const finished = useCountdownFinished(cd.targetDate);
  const [toastOpen, setToastOpen] = useState(false);
  const wasFinished = useRef(finished);

  // Show the done banner only when the timer crosses zero during this visit.
  useEffect(() => {
    if (finished && !wasFinished.current) setToastOpen(true);
    wasFinished.current = finished;
  }, [finished]);

  useEffect(() => {
    if (!toastOpen) return;
    const t = setTimeout(() => setToastOpen(false), 10000);
    return () => clearTimeout(t);
  }, [toastOpen]);

  // ── Which sections are visible right now ──
  // `finished` is read directly rather than being copied into state. A copy
  // refreshed in an effect always lands one render late, and by that render the
  // revealed sections have already been added — so the page painted the small
  // in-page countdown for a frame before dropping it. Deriving it instead puts
  // the timer leaving and the revealed sections arriving in the same commit.
  const revealIds = new Set(cd.revealSectionIds ?? []);
  const showCountdown = countdownOn && !finished;
  const isRevealed = (s: SectionEntry) =>
    finished && !s.enabled && revealIds.has(s.id) && s.type !== "countdown";
  const others = live.sections.filter(
    (s) => s.type !== "countdown" && (s.enabled || isRevealed(s))
  );

  // Maintenance mode overrides everything: no header, no footer, no sections.
  const maintenance = content.sections.some((s) => s.type === "maintenance" && s.enabled);
  if (maintenance) {
    return <MaintenancePage data={sectionData<MaintenanceData>(content, "maintenance")} />;
  }

  // A countdown with no other sections takes over the page: no header, no footer.
  if (countdownOn && others.length === 0) {
    if (!finished) return <CountdownPage data={cd} />;
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <DonePage data={cd} />
      </motion.div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <a
        href="#journey"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-5 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-ink-950"
      >
        Skip to content
      </a>
      <Navbar />
      <main>
        {live.sections.map((entry) => {
          // The countdown is simply gone once its timer has passed.
          if (entry.type === "countdown") {
            if (!showCountdown) return null;
            return <Section key={entry.id} entry={entry} />;
          }

          const revealed = isRevealed(entry);
          if (!entry.enabled && !revealed) return null;

          // Sections unveiled by the countdown fade in as it clears.
          if (revealed) {
            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: EASE }}
              >
                <SectionFrame entry={entry}>
                  <Section entry={entry} revealed />
                </SectionFrame>
              </motion.div>
            );
          }
          return (
            <SectionFrame key={entry.id} entry={entry}>
              <Section entry={entry} />
            </SectionFrame>
          );
        })}
      </main>
      <Footer />
      {toastOpen && <DoneToast message={cd.doneMessage} onClose={() => setToastOpen(false)} />}
    </div>
  );
}

function Shell() {
  const rawRoute = useHashRoute();
  // An exported site has no server behind it, so there is nothing to sign in
  // to: the dashboard is sent home rather than opened onto a login that can
  // only fail. Everything else is a normal page.
  const route = isStaticBuild() && ADMIN_PATHS.has(rawRoute) ? "" : rawRoute;
  const { content, ready, loadError } = useSite();
  const [loading, setLoading] = useState(true);

  // Every in-page link on every page: land the section's name under the
  // header. Installed here, above the routes that take the whole page over,
  // so it is running whenever there is a menu to click.
  useAnchorScroll();
  // And where each page opens: frontend pages at the top, the dashboard
  // where it was left.
  useRouteScroll(route);

  // Hide the loader as soon as the first paint has settled.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(t);
  }, []);

  // The saved site now comes from the database, so the first paint waits for
  // it. Showing the built-in defaults for a moment and then swapping would
  // flash the wrong content at every visitor.
  if (!ready) return <Loader logo={content.loaderLogo} animation={content.loaderAnimation} />;

  if (route === LIVE_MAP_PATH) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <LiveMapPage />
      </Suspense>
    );
  }
  if (route === NEARBY_PATH) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <NearbyPlacesPage />
      </Suspense>
    );
  }
  if (route === SHOP_PATH) {
    return <ShopPage />;
  }
  if (route === MEMBERS_PATH || route.startsWith(`${MEMBERS_PATH}?`)) {
    return <MembersPage />;
  }
  // The member's own garage: a signed-in-only page that is not part of the
  // site, is not in any nav, and reads nothing but that member's own records.
  if (route === MEMBER_TRACKER_PATH) {
    return <MemberTracker />;
  }
  // One saved place, opened from the garage and drawn on a map of its own.
  const memberPlaceId = memberPlaceIdFromRoute(route);
  if (memberPlaceId) {
    return <MemberPlacePage placeId={memberPlaceId} />;
  }
  if (ADMIN_PATHS.has(route)) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <AdminPage />
      </Suspense>
    );
  }

  return (
    <>
      {loadError && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-[95] bg-red-500/90 px-4 py-2 text-center text-xs font-medium text-white"
        >
          Could not load the saved site ({loadError}). Showing the built-in content.
        </div>
      )}
      {loading && <Loader logo={content.loaderLogo} animation={content.loaderAnimation} />}
      <LandingPage />
    </>
  );
}

/** Installed, but MariaDB did not answer. */
function DatabaseProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950 px-6 text-white">
      <div className="w-full max-w-md rounded-3xl glass p-8 text-center">
        <h1 className="font-display text-xl font-semibold">The database is not answering</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-xl bg-saffron-400 px-6 py-3 text-sm font-semibold text-on-gold"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * Boot gate.
 *
 * A freshly deployed copy has no database and no owner yet. The setup screen
 * has to open before anything that expects a database — including the site
 * loader — so this asks the server first and only then mounts the app.
 */
function SetupGate() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    siteApi
      .setupStatus()
      .then((next) => alive && setStatus(next))
      .catch((err) => alive && setError(describeApiError(err)));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-950 px-6 text-white">
        <div className="w-full max-w-md rounded-3xl glass p-8 text-center">
          <h1 className="font-display text-xl font-semibold">Cannot reach the server</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-6 rounded-xl bg-saffron-400 px-6 py-3 text-sm font-semibold text-on-gold"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!status) return <Loader />;

  const retry = () => {
    setStatus(null);
    setAttempt((n) => n + 1);
  };

  // This copy keeps its credentials in the environment (or the hosting panel),
  // so the setup screen must not offer to rewrite them. If the database is
  // down, say so and point at the environment.
  if (!status.installed && status.mode === "env") {
    return (
      <DatabaseProblem
        message={
          status.error ||
          "The database settings in the environment did not work. Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD, then try again."
        }
        onRetry={retry}
      />
    );
  }

  if (!status.installed || status.needsOwner) {
    return <SetupWizard status={status} onDone={() => window.location.reload()} />;
  }

  // Installed but the database did not answer. Showing the dashboard would
  // only produce a load-error banner; say what happened instead.
  if (!status.databaseReady) {
    return (
      <DatabaseProblem
        message={status.error || "Check that MariaDB is running, then try again."}
        onRetry={retry}
      />
    );
  }

  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  );
}

export default function App() {
  return <SetupGate />;
}
