import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  SiteProvider,
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
import { LIVE_MAP_PATH, SHOP_PATH, useHashRoute } from "./utils/router";
import AccountPage from "./auth/AccountPage";
import ShopPage from "./components/ShopPage";

// Heavy routes are split out so the landing page never downloads them.
const AdminPage = lazy(() => import("./admin/AdminPage"));
const LiveMapPage = lazy(() => import("./components/LiveMapPage"));

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
  const { content } = useSite();

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

  // ── Countdown fade-out: "live" → "fading" (1s) → "gone" (unmounted) ──
  const [cdPhase, setCdPhase] = useState<"live" | "fading" | "gone">(() =>
    finished ? "gone" : "live"
  );

  useEffect(() => {
    if (!finished) {
      setCdPhase("live");
      return;
    }
    if (cdPhase !== "live") return;
    setCdPhase("fading");
    const t = setTimeout(() => setCdPhase("gone"), 1050);
    return () => clearTimeout(t);
  }, [finished, cdPhase]);

  // ── Which sections are visible right now ──
  const revealIds = new Set(cd.revealSectionIds ?? []);
  const showCountdown = countdownOn && cdPhase !== "gone";
  const isRevealed = (s: SectionEntry) =>
    finished && !s.enabled && revealIds.has(s.id) && s.type !== "countdown";
  const others = content.sections.filter(
    (s) => s.type !== "countdown" && (s.enabled || isRevealed(s))
  );

  // Maintenance mode overrides everything: no header, no footer, no sections.
  const maintenance = content.sections.some((s) => s.type === "maintenance" && s.enabled);
  if (maintenance) {
    return <MaintenancePage data={sectionData<MaintenanceData>(content, "maintenance")} />;
  }

  // A countdown with no other sections takes over the page: no header, no footer.
  if (countdownOn && others.length === 0) {
    return (
      <>
        {cdPhase !== "gone" && (
          <motion.div
            initial={false}
            animate={
              cdPhase === "fading"
                ? { opacity: 0, filter: "blur(10px)", scale: 0.985 }
                : { opacity: 1, filter: "blur(0px)", scale: 1 }
            }
            transition={{ duration: 1, ease: EASE }}
          >
            <CountdownPage data={cd} />
          </motion.div>
        )}
        {cdPhase === "gone" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, ease: EASE }}
          >
            <DonePage data={cd} />
          </motion.div>
        )}
      </>
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
        {content.sections.map((entry) => {
          // Countdown: fades and collapses in place, then unmounts.
          if (entry.type === "countdown") {
            if (!showCountdown) return null;
            return (
              <motion.div
                key={entry.id}
                initial={false}
                animate={
                  cdPhase === "fading"
                    ? { opacity: 0, height: 0, filter: "blur(8px)" }
                    : { opacity: 1, height: "auto", filter: "blur(0px)" }
                }
                transition={{ duration: 1, ease: EASE }}
                className="overflow-hidden"
              >
                <Section entry={entry} />
              </motion.div>
            );
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
                transition={{ duration: 0.9, delay: 0.45, ease: EASE }}
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
  const route = useHashRoute();
  const { content } = useSite();
  const [loading, setLoading] = useState(true);

  // Hide the loader as soon as the first paint has settled.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(t);
  }, []);

  const verificationReturn = new URLSearchParams(window.location.search).get("auth") === "verified";
  if (route === "/account" || verificationReturn) {
    return <AccountPage />;
  }

  if (route === LIVE_MAP_PATH) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <LiveMapPage />
      </Suspense>
    );
  }
  if (route === SHOP_PATH) {
    return <ShopPage />;
  }
  if (route === "/admin") {
    return (
      <Suspense fallback={<RouteFallback />}>
        <AdminPage />
      </Suspense>
    );
  }

  return (
    <>
      {loading && <Loader logo={content.loaderLogo} animation={content.loaderAnimation} />}
      <LandingPage />
    </>
  );
}

export default function App() {
  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  );
}
