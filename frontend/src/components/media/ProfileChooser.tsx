import { useLayoutEffect } from "react";
import { Check, UserRound } from "lucide-react";
import { mediaProfiles, type MediaProfileId } from "../../lib/media";

export default function ProfileChooser({ current, choose }: { current: MediaProfileId | null; choose: (profile: MediaProfileId) => void }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.tvProfileChooser = "true";
    return () => { delete document.documentElement.dataset.tvProfileChooser; };
  }, []);

  return <section className="media-profile-gate" aria-labelledby="profile-heading">
    <div className="media-profile-panel">
      <p className="media-profile-kicker">HOMELAB CINEMA</p>
      <h1 id="profile-heading">Who’s watching?</h1>
      <p>Choose an account to see your own Continue Watching list.</p>
      <div className="media-profile-grid">
        {mediaProfiles.map(profile => <button key={profile.id} type="button" className={`media-profile-card media-profile-${profile.color}`} aria-pressed={current === profile.id} onClick={() => choose(profile.id)}>
          <span className="media-profile-avatar"><UserRound aria-hidden="true" /></span>
          <strong>{profile.name}</strong>
          {current === profile.id && <span className="media-profile-current"><Check aria-hidden="true" /> Current</span>}
        </button>)}
      </div>
    </div>
  </section>;
}
