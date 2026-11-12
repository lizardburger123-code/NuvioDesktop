import "./Ratings.css";

/** A tomato when critics liked it, a splat when they didn't; a popcorn tub for the audience. */
const Tomato = ({ fresh }) => (fresh ? (
  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9.2" r="5.6" fill="#f0503c" /><path d="M8 4.4 5.4 2.6l.5 2.2-2.1.5L6 6.4 8 5.6l2 .8 2.2-1.1-2.1-.5.5-2.2z" fill="#58b368" /></svg>
) : (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2c1.2 1.6 2.8.4 3.6 1.8.7 1.3 2.6 1.3 2.4 3.2-.2 1.7 1 2.6-.4 3.9-1.2 1.1-.6 2.7-2.4 2.9-1.6.2-2.3-1-3.2-1s-1.9 1.3-3.4.8c-1.6-.5-.9-2.2-2.2-3C1 9.9 1.9 8.6 1.8 7.400c-.2-1.7 1.7-1.8 2.3-3 .7-1.5 2.6-.500 3.9-2.200z" fill="#8bbf3f" /></svg>
));
const Popcorn = ({ liked }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.6 7h8.800l-1.2 7.200H4.800z" fill={liked ? "#f0503c" : "#7e8794"} /><path d="M6.3 7l.5 7.200M9.7 7l-.5 7.2" stroke="#fff" strokeWidth="1" opacity=".85" />
    <circle cx="5.2" cy="5.4" r="2" fill="#ffd166" /><circle cx="8" cy="4.3" r="2.2" fill="#ffe39a" /><circle cx="10.8" cy="5.4" r="2" fill="#ffd166" />
  </svg>
);
const Star = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.6 1.9 4.1 4.5.5-3.3 3.1.9 4.500L8 11.500l-4 2.3.9-4.500L1.6 6.200l4.5-.5z" fill="#ffd166" /></svg>;

const percent = value => `${Math.round(value)}%`;
/** The sites worth a place beside the release date, in reading order. */
const SITES = [
  { source: "imdb", name: "IMDb", text: value => Number(value).toFixed(1), icon: () => <Star /> },
  { source: "tomatoes", name: "Rotten Tomatoes", short: "RT", text: percent, icon: rating => <Tomato fresh={rating.value >= 60} /> },
  { source: "audience", name: "Rotten Tomatoes audience", short: "Audience", text: percent, icon: rating => <Popcorn liked={rating.value >= 60} /> },
  { source: "metacritic", name: "Metacritic", short: "MC", text: value => String(Math.round(value)) },
  { source: "letterboxd", name: "Letterboxd", short: "LB", text: value => Number(value).toFixed(1) },
];

/** A title's scores as it has them: IMDb from the catalog, the rest from MDBList when a key is set. */
export const ratingsOf = meta => {
  const list = Array.isArray(meta?.ratings) ? meta.ratings.filter(rating => Number(rating.value) > 0) : [];
  const found = SITES.map(site => {
    const rating = list.find(entry => entry.source === site.source);
    return rating ? { site, rating } : null;
  }).filter(Boolean);
  if (!found.some(entry => entry.site.source === "imdb") && Number(meta?.imdbRating) > 0) {
    found.unshift({ site: SITES[0], rating: { source: "imdb", value: Number(meta.imdbRating) } });
  }
  return found;
};

/** Scores as small plates: IMDb 8.4, a tomato and 93%, popcorn and 88%. */
export default function Ratings({ meta }) {
  const found = ratingsOf(meta);
  if (!found.length) return null;
  return (
    <span className="ratings">
      {found.map(({ site, rating }) => (
        <span key={site.source} className="rating num" title={`${site.name}: ${site.text(rating.value)}${rating.certified ? " (Certified Fresh)" : ""}`}>
          {site.icon ? site.icon(rating) : null}
          <b>{site.text(rating.value)}</b>
          {site.source === "imdb" || !site.icon ? <small>{site.short || site.name}</small> : null}
        </span>
      ))}
    </span>
  );
}

/** An episode's score, written beside its air date. */
export const EpisodeScore = ({ value }) => (Number(value) > 0 ? <span className="ep-score num" title="Episode score"><Star />{Number(value).toFixed(1)}</span> : null);
