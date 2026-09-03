/** Microsoft's own applications, by the id their records carry. A Purview
record names no application: it files the id and stops, and an id says nothing
to anyone reading a table. Microsoft publish the pairing, and most of what signs
in to a tenant is one of theirs.

`microsoft-apps.json` is [merill/microsoft-info][1], MIT licensed, rebuilt daily
from Graph, the Entra documentation and contributions, put through
`microsoft-apps.jq` to drop the two thirds of it that are not applications.
Refresh it by running that:

    curl -sSL https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/role-based-access-control/built-in-roles.md |
      grep -oiE '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}' | tr 'A-F' 'a-f' | sort -u > /tmp/azure-roles
    curl -sSL https://raw.githubusercontent.com/merill/microsoft-info/main/_info/MicrosoftApps.json |
      jq -S --rawfile roles /tmp/azure-roles -f src/lib/microsoft-apps.jq > src/lib/microsoft-apps.json

`microsoft-apps-extra.json` is what that list misses, hand kept because no
upstream carries it: non-Microsoft clients that speak to a mailbox and so turn
up in an audit export, and the OAuth applications used to steal from one.
Gathered from [o365-appids][2], [randomaccess3/detections][3], a
[first-party gist][4] and [CreateMissingServicePrincipals.ps1][5]. Add to it by
hand when a tenant turns up an id nobody has written down.

[1]: https://github.com/merill/microsoft-info
[2]: https://github.com/dmb2168/o365-appids
[3]: https://github.com/randomaccess3/detections
[4]: https://gist.github.com/piaudonn/aa43224b0f58c5ce706738f92428ea60
[5]: https://github.com/michaelmsonne/public */
let names: Record<string, string> = {}

/** Reads the list in, once. 190KB of it, which is most of a page load on its
own, so it is fetched when a file is dropped rather than when the page is
opened: by then the user has just read a hundred megabytes off their own disk
and will not notice this. */
let reading: Promise<void> | undefined
export const loadAppNames = () =>
  (reading ??= Promise.all([
    import("./microsoft-apps.json"),
    import("./microsoft-apps-extra.json"),
  ]).then(([list, extra]) => {
    // Microsoft's own naming wins where both have an id.
    names = { ...extra.default, ...list.default }
  }))

/** What Microsoft call the application behind an id. A tenant's own
applications are not on the list and come back undefined, which is what an
unknown id reads as too. */
export const appName = (id: unknown) =>
  typeof id === "string" ? names[id.toLowerCase()] : undefined
