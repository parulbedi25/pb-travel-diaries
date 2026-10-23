import * as React from "react";
import type { JourneyData, Destination, TripStop } from "../store/siteContent";

/** Only local assets: a saved external URL never triggers an image request. */
function tripStoryImage(value?: string): string {
  return typeof value === "string" && /^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020]/.test(value) ? value : "";
}

function TripStoryPhoto({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  return <div className="trip-story-photo">
    {src && !failed ? <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} /> :
      <div className="trip-story-placeholder"><span aria-hidden="true">↗</span><p>The road has a story.</p><small>Photo to follow</small></div>}
  </div>;
}

/** Existing journeys stay readable; checkpoints are an additive content field. */
export default function Showcase({ data }: { data: JourneyData }) {
  const trips: Destination[] = (Array.isArray(data.destinations) ? data.destinations : []).filter(d => d && (d as Destination & { enabled?: boolean }).enabled !== false);
  const [tripIndex, setTripIndex] = React.useState(0);
  const [chapterIndex, setChapterIndex] = React.useState(0);
  const instance = React.useId();
  const trip = trips[Math.min(tripIndex, Math.max(0, trips.length - 1))];
  const stops: TripStop[] = Array.isArray(trip?.stops) ? trip.stops.filter(s => s && s.enabled !== false) : [];
  const chapters: TripStop[] = stops.length ? stops : trip ? [{ title: trip.name, notes: trip.description, image: trip.image, caption: trip.tagline }] : [];
  const current = Math.min(chapterIndex, Math.max(0, chapters.length - 1));
  const chapter = chapters[current];
  const panelId = `${instance}-story`;
  const routeRef = React.useRef<HTMLOListElement>(null);
  const image = tripStoryImage(chapter?.image) || tripStoryImage(trip?.image);

  const chooseChapter = (index: number) => setChapterIndex(Math.max(0, Math.min(index, chapters.length - 1)));
  const routeKey = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = Math.min(index + 1, chapters.length - 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = chapters.length - 1;
    else return;
    event.preventDefault();
    chooseChapter(next);
    routeRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return <section id="journey" className="trip-stories" aria-labelledby={`${instance}-title`}>
    <div className="trip-stories-inner">
      <header className="trip-story-header">
        <p className="trip-story-eyebrow">{data.eyebrow || "From the road"} / Interactive trip stories</p>
        <h2 id={`${instance}-title`}>{data.titleA}<span>{data.titleHi}</span>{data.titleB}</h2>
        <p>{data.sub}</p>
      </header>
      {!trip ? <p className="trip-story-empty">No journeys published yet. The next story starts on the road.</p> : <>
        <nav className="trip-story-picker" aria-label="Choose a trip story">
          {trips.map((item, index) => <button type="button" key={index} aria-pressed={trip === item}
            onClick={() => { setTripIndex(index); setChapterIndex(0); }}>
            <span className="trip-picker-number">{String(index + 1).padStart(2, "0")}</span>{item.name}
          </button>)}
        </nav>
        <div className="trip-story-meta"><span>{trip.state}</span><span>{trip.distance}</span><span>{trip.days}</span><span>{trip.season}</span></div>
        <div className="trip-story-stage" id={panelId}>
          <div className="trip-story-visual">
            <TripStoryPhoto key={`${image}-${tripIndex}-${current}`} src={image} alt={chapter.caption || `${trip.name} — ${chapter.title}`} />
            <span className="trip-story-badge">{trip.vibe || "Travel diary"}</span>
            <div className="trip-story-caption"><span>{trip.name}</span><p>{chapter.caption || trip.tagline}</p></div>
          </div>
          <article className="trip-story-article" aria-labelledby={`${instance}-chapter-title`}>
            <div className="trip-story-chapter-label"><span>{stops.length ? `Chapter ${String(current + 1).padStart(2, "0")}` : "The overview"}</span>{chapter.day && <span>{chapter.day}</span>}</div>
            <h3 id={`${instance}-chapter-title`}>{chapter.title}</h3>
            <p className="trip-story-notes">{chapter.notes || trip.description}</p>
            {chapter.food && <aside className="trip-story-fieldnote"><span>At the table</span><p>{chapter.food}</p></aside>}
            {chapter.tip && <aside className="trip-story-fieldnote"><span>A note from the road</span><p>{chapter.tip}</p></aside>}
            <div className="trip-story-controls">
              <button type="button" disabled={current === 0} onClick={() => chooseChapter(current - 1)} aria-label="Previous chapter">← <span>Previous</span></button>
              <span role="status" aria-live="polite" aria-atomic="true">{current + 1} / {chapters.length} · {chapter.title}</span>
              <button type="button" disabled={current === chapters.length - 1} onClick={() => chooseChapter(current + 1)} aria-label="Next chapter"><span>Next</span> →</button>
            </div>
          </article>
        </div>
        {stops.length > 0 && <div className="trip-story-route">
          <div className="trip-story-route-heading"><p>Follow the story</p><span>Chapter route · not navigation directions</span></div>
          <ol ref={routeRef} aria-label={`${trip.name} story checkpoints`}>
            {chapters.map((stop, index) => <li key={index} data-current={index === current} data-past={index < current}>
              <button type="button" aria-current={index === current ? "step" : undefined} aria-controls={panelId}
                onClick={() => chooseChapter(index)} onKeyDown={event => routeKey(event, index)}>
                <span className="trip-story-checkpoint">{String(index + 1).padStart(2, "0")}</span>
                <span className="trip-story-stop-name">{stop.title}</span>{stop.day && <small>{stop.day}</small>}
              </button>
            </li>)}
          </ol>
          <div className="trip-story-progress" role="progressbar" aria-label="Story chapter position" aria-valuemin={1} aria-valuemax={chapters.length} aria-valuenow={current + 1} aria-valuetext={`Chapter ${current + 1} of ${chapters.length}`}><span style={{ width: `${((current + 1) / chapters.length) * 100}%` }} /></div>
        </div>}
      </>}
    </div>
  </section>;
}
