import { navigate } from "../lib/router.js";

const monogram = name => name.split(/\s+/).map(word => word[0]).join("").slice(0, 2);

/** One member of the cast. Click them for everything else they are in. */
export default function Person({ person }) {
  return (
    <button
      className="person"
      onClick={() => navigate("person", { name: person.name, photo: person.photo || null })}
      title={`More with ${person.name}`}
    >
      {person.photo ? <img src={person.photo} alt="" loading="lazy" /> : <span className="person-mono">{monogram(person.name)}</span>}
      <span className="person-name" dir="auto">{person.name}</span>
      {person.role ? <span className="person-role" dir="auto">{person.role}</span> : null}
    </button>
  );
}
