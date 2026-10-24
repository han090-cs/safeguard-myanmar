// About dialog body (purpose, limits, glossary, privacy, credits) in React. The long texts and data loading stay in about.js / help.js.
import { Fragment } from "react";
import { put } from "./slots.js";

const Link = ({ n, u }) => (u ? <a href={u} target="_blank" rel="noopener">{n}</a> : n);

function About({ s }) {
  const { m, C, t } = s;
  const Ps = a => a.map((x, i) => <p key={i}>{x}</p>);
  const Ul = a => <ul>{a.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  return (
    <>
      <h3>{t("s_goal")}</h3>{Ps(m ? C.goal : C.goal_en)}
      <h3>{t("s_in")}</h3><p>{t("inn")}</p>
      <h3>{t("s_lim")}</h3>{Ul(m ? C.lim : C.lim_en)}
      <h3>{t("s_how")}</h3>{Ul(m ? C.how : C.how_en)}
      <h3>{t("s_gloss")}</h3>
      <div data-help="all">{s.help.map((g, i) => (
        <Fragment key={i}><h4>{g.head}</h4>{g.items.map((x, j) => <details className="help-d" key={j}><summary><strong>{x.t}</strong></summary><p className="help-p">{x.b}</p></details>)}</Fragment>
      ))}</div>
      <h3>{t("s_priv")}</h3>{Ul(m ? C.priv : C.priv_en)}
      <h3>{t("s_cred")}</h3><p>{t("credtxt")}</p>
      {C.credgroups.map(([gm, ge, items], i) => (
        <Fragment key={i}><h4>{m ? gm : ge}</h4><ul>{items.map(([n, u, r], j) => <li key={j}><Link n={n} u={u} />{" "}<span className="o75">· {r}</span></li>)}</ul></Fragment>
      ))}
      {s.agri ? <><h4>{t("agri")}</h4><ul>{s.agri.map((x, i) => <li key={i}><Link n={x.n} u={x.u} /></li>)}</ul></> : null}
      {s.people ? <><h4>{m ? "ပုဂ္ဂိုလ်များ" : "People"}</h4><ul>{s.people.map((p, i) => <li key={i}>{p.name}{p.role ? ` · ${p.role}` : ""}</li>)}</ul></> : null}
    </>
  );
}
export function mountAboutView() { return s => put("aboutBody", <About s={s} />); }
