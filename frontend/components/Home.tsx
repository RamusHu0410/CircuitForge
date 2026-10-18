import { useRef, useState } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { Logo } from "./Logo";

const EXAMPLES = [
  "Two-player football game with two joysticks and LEDs for game state and scoring",
  "555 timer blinking an LED at 2 Hz on 9V",
  "3.3V LDO from 5V with power LED",
];

interface Props {
  onBuild: (prompt: string) => void;
  onLearn: () => void;
  onWorkspace: () => void;
}

/** First screen: ask what to build. The tutorial is one click away, never in the way. */
export function Home({ onBuild, onLearn, onWorkspace }: Props) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  const build = () => {
    const t = text.trim();
    if (!t) {
      setHint(true);
      ta.current?.focus();
      return;
    }
    onBuild(t);
  };

  return (
    <main className="home">
      <div className="home-inner">
        <Logo size={44} animate />
        <h1>What do you want to build today?</h1>
        <div className="home-box">
          <textarea
            ref={ta}
            autoFocus
            rows={3}
            value={text}
            aria-label="Describe what you want to build"
            placeholder="Describe your circuit or project in plain words…"
            onChange={(e) => {
              setText(e.target.value);
              setHint(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                build();
              }
            }}
          />
          {hint && <div className="composer-hint" role="status">Type what you want to build first.</div>}
          <div className="home-actions">
            <button className="btn home-primary" onClick={build}>
              Build it <ArrowRight size={15} />
            </button>
            <button className="btn" onClick={onLearn}>
              <BookOpen size={15} /> Learn how to design hardware
            </button>
          </div>
        </div>
        <div className="home-examples" aria-label="Examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => setText(e)}>
              {e}
            </button>
          ))}
        </div>
        <button className="link home-workspace" onClick={onWorkspace}>
          or open the example workspace
        </button>
      </div>
    </main>
  );
}
