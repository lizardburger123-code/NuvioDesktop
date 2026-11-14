import { navigate } from "../lib/router.js";
import { useLite } from "../lib/lite.js";
import { sized } from "../lib/images.js";

const monogram = name => name.split(/\s+/).map(word => word[0]).join("").slice(0, 2);

/**
 * One member of the cast. Click them for everything else they are in. The title they were picked
 * from (an IMDb id) goes along, so the person page can tell namesakes apart.
 */
export default function Person({ person, titleId }) {
  const lite = useLite();
  const from = typeof titleId === "string" && titleId.startsWith("tt") ? { titleId } : {};
  return (
    <button
      className="person"
      onClick={() => navigate("person", { name: person.name, photo: person.photo || null, ...from })}
      title={`More with ${person.name}`}
    >
      {person.photo ? <img src={sized(person.photo, "face", lite)} alt="" loading="lazy" decoding={lite ? "async" : undefined} /> : <span className="person-mono">{monogram(person.name)}</span>}
      <span className="person-name" dir="auto">{person.name}</span>
      {person.role ? <span className="person-role" dir="auto">{person.role}</span> : null}
    </button>
  );
}
