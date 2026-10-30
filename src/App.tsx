import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { isStaticBuild, isStaticHosting } from "./utils/staticSite";
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
import { apiBase, describeApiError, hasApiBase, hasPhpSetup, phpDiagnosis } from "./api/client";

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
 * The bootstrap is in this folder and did not answer.
 *
 * An export made with `--php` carries `api.php` on purpose; if `/api/setup/…`
 * comes back as HTML or not at all, the file is missing, PHP is not running, or
 * the host is not serving it. The one thing that must not happen is the site
 * opening as though it were a finished deployment with no database behind it —
 * which is a table-less site that looks fine until the dashboard is opened.
 */
/** What the file itself reported, when it ran at all. */
interface Diagnosis {
  ok?: boolean;
  what?: string;
  php?: string;
  sapi?: string;
  server?: string;
  installed?: boolean;
  configFile?: { present?: boolean; readable?: boolean };
  extensions?: Record<string, boolean>;
  folderWritable?: boolean;
  database?: {
    driver?: string;
    host?: string;
    database?: string;
    connect?: { ok?: boolean; detail?: string };
    tables?: Record<string, boolean>;
  };
}

function BootstrapProblem({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  // The page can reach this server; the setup step cannot. So the page asks the
  // file directly and shows the answer — a fatal error, a missing file and a
  // database that will not connect read completely differently here.
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [checking, setChecking] = useState(true);
  const [probe, setProbe] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setProbe(null);
    const answer = await phpDiagnosis<Diagnosis>();
    setDiag(answer);
    if (!answer) {
      // Nothing answered at all: say what one plain request came back with.
      try {
        const response = await fetch("/api.php?route=diag", { cache: "no-store" });
        const text = await response.text();
        setProbe(
          `${response.status} ${response.headers.get("content-type") ?? "no content type"} · ${
            text.trim() ? text.slice(0, 200) : "empty body"
          }`,
        );
      } catch (failure) {
        setProbe(describeApiError(failure));
      }
    }
    setChecking(false);
  };

  useEffect(() => {
    void check();
  }, []);

  const tables = diag?.database?.tables ?? {};
  const missing = Object.entries(tables).filter(([, present]) => !present).map(([name]) => name);
  const extensionProblem = diag?.extensions
    ? !diag.extensions.pdo || !(diag.extensions.pdo_mysql || diag.extensions.pdo_sqlite)
    : false;

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950 px-6 text-white">
      <div className="w-full max-w-xl rounded-3xl glass p-8">
        <h1 className="font-display text-xl font-semibold">The setup file is not answering</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          This folder was exported with the PHP bootstrap, so it should create its database on the
          first visit — but <span className="font-mono text-xs text-zinc-300">api.php</span> did not
          answer, and no tables were created.
        </p>
        {error && (
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 font-mono text-[11px] leading-relaxed text-amber-200/90">
            {error}
          </pre>
        )}

        {/* What the file itself says, when it answered at all. */}
        <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              What the server says
            </p>
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
            >
              {checking ? "Checking…" : "Check again"}
            </button>
          </div>

          {checking && <p className="mt-3 text-sm text-zinc-500">Asking api.php…</p>}

          {!checking && diag && (
            <div className="mt-3 space-y-1.5 font-mono text-[11px] leading-relaxed text-zinc-300">
              <p className="text-emerald-300">{diag.what ?? "The PHP setup file is running."}</p>
              <p>PHP {diag.php} · {diag.sapi}</p>
              {diag.server && <p>{diag.server}</p>}
              <p>
                php-config.php: {diag.configFile?.present ? "present" : "MISSING"} ·{" "}
                {diag.configFile?.readable ? "readable" : "not readable"}
              </p>
              <p>
                extensions:{" "}
                {Object.entries(diag.extensions ?? {})
                  .map(([name, on]) => `${name} ${on ? "✓" : "✗"}`)
                  .join(" · ")}
              </p>
              {diag.database && (
                <p>
                  database: {diag.database.driver} {diag.database.host ?? ""} ·{" "}
                  {diag.database.connect?.ok ? "connected" : `failed — ${diag.database.connect?.detail ?? "no detail"}`}
                </p>
              )}
              {missing.length > 0 && (
                <p className="text-amber-200/90">tables missing: {missing.join(", ")}</p>
              )}
              {diag.installed && <p className="text-emerald-300">The database is installed.</p>}
            </div>
          )}

          {!checking && !diag && (
            <div className="mt-3 space-y-1.5 text-sm text-zinc-400">
              <p className="text-amber-200/90">api.php did not answer with JSON.</p>
              {probe && <p className="font-mono text-[11px] text-zinc-400">{probe}</p>}
              <p className="text-[11px] leading-relaxed text-zinc-500">
                An <span className="font-mono">empty</span> answer usually means PHP ran the file and
                it hit a fatal error — check the host&apos;s PHP error log. A{" "}
                <span className="font-mono">404</span> means api.php is not in this folder. Downloaded
                source means PHP is not enabled for it. Re-exporting with{" "}
                <span className="font-mono">--php</span> and uploading{" "}
                <span className="font-mono">api.php</span> fixes the last two.
              </p>
            </div>
          )}

          {!checking && diag && extensionProblem && (
            <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200/90">
              The database extension is missing. In cPanel → <strong>Select PHP Version</strong>, tick{" "}
              <span className="font-mono">pdo_mysql</span>, then try again.
            </p>
          )}
        </div>

        <ul className="mt-4 space-y-2 text-sm text-zinc-400">
          <li>
            <span className="text-white">1.</span> Is{" "}
            <span className="font-mono text-xs text-zinc-300">api.php</span> in the same folder as{" "}
            <span className="font-mono text-xs text-zinc-300">index.html</span>? Some file managers
            skip it when a ZIP is extracted.
          </li>
          <li>
            <span className="text-white">2.</span> Open{" "}
            <a className="text-saffron-300 underline" href="/api.php?route=setup/status">
              /api.php?route=setup/status
            </a>{" "}
            — it should show a line of JSON. If it downloads as a file instead, PHP is not running
            for this folder.
          </li>
          <li>
            <span className="text-white">3.</span> PHP 8.0 or newer, and{" "}
            <span className="font-mono text-xs text-zinc-300">php-config.php</span> present with the
            database details.
          </li>
        </ul>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl bg-saffron-400 px-6 py-3 text-sm font-semibold text-on-gold"
          >
            Try again
          </button>
          <a
            href="/?skip-setup=1"
            className="rounded-xl border border-white/15 px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
          >
            Show the website anyway
          </a>
        </div>
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
  /** The folder promised a PHP bootstrap and it did not answer. */
  const [setupProblem, setSetupProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Set when there is no API to ask — an export uploaded to a plain file host.
  // `?skip-setup=1` is the deliberate escape from the bootstrap screen below.
  const [staticHost, setStaticHost] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("skip-setup"),
  );

  useEffect(() => {
    let alive = true;
    setError(null);
    setSetupProblem(null);
    /**
     * Both a refusal and a host that answers with the page itself mean the same
     * thing here — unless this page was exported pointing at an API, in which
     * case the site is served from a database and "no server" is a fault, not a
     * mode. Returning false there sends it to the error screen with the address.
     */
    const noServer = async (): Promise<boolean> => {
      if (hasApiBase()) return false;
      if (await isStaticHosting()) return true;
      return false;
    };
    siteApi
      .setupStatus()
      .then(async (next) => {
        if (!alive) return;
        // A catch-all host answers 200 with its own HTML; the client cannot
        // parse that, and the result is nothing shaped like a setup status.
        if (!next || typeof next !== "object" || typeof next.installed !== "boolean") {
          if (await noServer()) {
            if (hasPhpSetup() && alive) {
              setSetupProblem(
                "The address answered, but not with the setup status — it is probably the website itself. Check that api.php is in this folder and that PHP runs for it.",
              );
              return;
            }
            if (alive) setStaticHost(true);
            return;
          }
          if (alive) setError("The server answered something that is not the setup status.");
          return;
        }
        setStatus(next);
      })
      .catch(async (err) => {
        if (!alive) return;
        // A 404 from a file host is not a broken server: it is a folder of
        // files, which is exactly what the static export produces. Asking any
        // further question of it would only produce more of the same 404.
        if (await noServer()) {
          // A folder exported with `--php` promised a bootstrap. Falling back to
          // the site here is what let a deployment open with no tables and no
          // setup screen, so it is reported instead.
          if (hasPhpSetup() && alive) {
            setSetupProblem(describeApiError(err));
            return;
          }
          if (alive) setStaticHost(true);
          return;
        }
        if (alive) {
          setError(
            hasApiBase()
              ? `The API at ${apiBase()} did not answer (${describeApiError(err)}). ` +
                "The site is served from its database, so start the Node app and reload."
              : describeApiError(err),
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  // No server behind this page: the content is compiled in, or in
  // `content.json` beside it. The site mounts; the dashboard stays out of reach
  // on its own, because `isStaticBuild()` refuses the admin paths.
  if (staticHost) {
    return (
      <SiteProvider>
        <Shell />
      </SiteProvider>
    );
  }

  if (setupProblem) {
    return (
      <BootstrapProblem
        error={setupProblem}
        onRetry={() => {
          setStatus(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

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
