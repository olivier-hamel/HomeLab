import { useLayoutEffect, type CSSProperties } from "react";
import { Check, UserRound } from "lucide-react";
import { type MediaProfile, type MediaProfileId } from "../../lib/media";

export default function ProfileChooser({ current, profiles, connectedName, choose }: { current: MediaProfileId | null; profiles: MediaProfile[]; connectedName: string; choose: (profile: MediaProfileId) => void }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.tvProfileChooser = "true";
    return () => { delete document.documentElement.dataset.tvProfileChooser; };
  }, []);

  return <section className="media-profile-gate" aria-labelledby="profile-heading">
    <div className="media-profile-panel">
      <p className="media-profile-kicker">HOMELAB CINEMA</p>
      <h1 id="profile-heading">Who’s watching?</h1>
      <p>Choisis un profil cinéma pour sa liste de films et ses recommandations.</p>
      <p>Connecté à HomeLab : <strong>{connectedName}</strong>. Changer de profil cinéma ne change pas ton compte HomeLab.</p>
      <div className="media-profile-grid">
        {profiles.map((profile, index) => <button key={profile.id} type="button" style={{ "--tv-stagger": `${index * 65}ms` } as CSSProperties} className={`media-profile-card media-profile-${profile.color}`} aria-pressed={current === profile.id} onClick={() => choose(profile.id)}>
          <span className="media-profile-avatar"><UserRound aria-hidden="true" /></span>
          <strong>{profile.name}</strong>
          {current === profile.id && <span className="media-profile-current"><Check aria-hidden="true" /> Current</span>}
        </button>)}
      </div>
    </div>
  </section>;
}
