import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useSite } from "../store/siteContent";
import { cn } from "../utils/cn";

/**
 * Dark / light switch.
 *
 * Shared by the site header, the countdown page and the maintenance page. The
 * last two replace the whole site rather than sitting inside it, so the
 * header's toggle is not on screen there — without this they were stuck on
 * whatever theme the browser remembered, with no way to change it.
 *
 * The theme is site-wide and remembered, so switching it on one of those
 * screens also sets what visitors see once the real site is back.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useSite();
  const light = theme === "light";

  return (
    <button
      type="button"
      onClick={() => setTheme(light ? "dark" : "light")}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={light}
      className={cn(
        "shrink-0 aspect-square relative grid h-10 w-10 place-items-center overflow-hidden rounded-full glass text-zinc-300 transition-all duration-300 hover:text-white active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400",
        className
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ y: 14, opacity: 0, rotate: -90 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 90 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="grid place-items-center"
        >
          {light ? <Moon className="h-4.5 w-4.5" /> : <Sun className="h-4.5 w-4.5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
