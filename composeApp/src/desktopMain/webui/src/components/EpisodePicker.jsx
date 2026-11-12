import { LuChevronDown } from "react-icons/lu";
import "./EpisodePicker.css";

const seasonName = season => (season === 0 ? "Specials" : `Season ${season}`);

/**
 * Jump to any episode from the top of a series' page: one menu, episodes grouped by season.
 * Choosing one makes it the episode the Play button starts.
 */
export default function EpisodePicker({ meta, seasons, value, onPick }) {
  const videos = (meta.videos || []).filter(video => video.season != null && video.episode != null);
  if (videos.length < 2) return null;
  const current = videos.find(video => video.id === value);
  return (
    <label className="ep-picker" title="Choose an episode">
      <span className="ep-picker-text num">
        {current ? <><b>S{current.season} · E{current.episode}</b><span dir="auto">{current.title || `Episode ${current.episode}`}</span></> : <b>Choose an episode</b>}
      </span>
      <LuChevronDown aria-hidden="true" />
      <select
        aria-label="Episode"
        value={current ? current.id : ""}
        onChange={event => { const video = videos.find(entry => entry.id === event.target.value); if (video) onPick(video); }}
      >
        {current ? null : <option value="" disabled>Choose an episode</option>}
        {seasons.map(season => (
          <optgroup key={season} label={seasonName(season)}>
            {videos.filter(video => video.season === season).map(video => (
              <option key={video.id} value={video.id} disabled={video.available === false}>
                {`${video.episode}. ${video.title || `Episode ${video.episode}`}${video.watched ? "  ✓" : ""}${video.available === false ? "  (upcoming)" : ""}`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
