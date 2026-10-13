# Legal Documents

The public legal-document app route is `/terms`, `/privacy`, `/license`, or
`/responsible-use`. Each path uses the same reader layout: a section-navigation
sidebar and a Markdown document with anchor links. The route loads Terms and
Privacy from `public/pages/terms-of-use.md` and
`public/pages/privacy-policy.md`; the License and Responsible Use Policy are
bundled from `LICENSE` and `RESPONSIBLE_USE.md`.

## Documents

- **Terms of Use** (`/terms`) summarizes license compliance, user
  responsibility, the lack of correctness guarantees, service availability,
  and contact information. It links to the License and Responsible Use Policy.
- **Privacy Policy** (`/privacy`) describes information handled for account
  authentication, app/session operation, user-provided information, and
  operational logs; it also explains stated collection limits, rights, data
  retention, security, and contact channels.
- **License** (`/license`) displays the repository's Hippocratic License 3.0
  text. The full license is the controlling source for its terms.
- **Responsible Use Policy** (`/responsible-use`) displays the repository
  policy incorporated by reference into the license and terms.

The navigation sidebar links to document sections. For exact, current terms,
read the document at the requested route and its linked source. This guide is
only a route description and is not a substitute for the legal documents or
legal advice.

## Agent access

These are public reading routes, not executable WebMCP surfaces. The
capability manifest marks them `non-agent`; that means no agent-driven actions
are exposed, not that the pages or their Markdown guides are unavailable.
