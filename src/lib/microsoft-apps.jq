# Turns merill/microsoft-info's list into the id-to-name map `microsoft-apps.ts`
# reads. See that file for how to run it.
#
# Most of what comes in is not an application. The Entra docs source is a
# spell-checker dictionary of every GUID the documentation mentions, so it
# carries Graph permissions, Purview classifiers, licence SKUs, FIDO
# authenticator models and Azure roles alongside the apps, and they are two
# thirds of the file. The filtering below is held to that source, because it is
# the only one that needs it: an entry Graph or the community list confirms is
# an application is kept whatever it is called. That matters, because a service
# principal is quite happy to be named `Microsoft.Azure.SyncFabric`, which reads
# exactly like the permission names being dropped.
#
# `$roles` is the GUIDs off the Azure built-in roles page, one to a line.
($roles | split("\n") | map(select(. != "")) | INDEX(.)) as $roles

| map(.AppId |= ascii_downcase)
| map(select(.AppId | test("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")))
# The upstream tags the names it took from contributions rather than from
# Microsoft. That is provenance, not part of the name.
| map(.AppDisplayName |= (sub(" \\[Community Contributed\\]$"; "") | ltrimstr(" ") | rtrimstr(" ")))
| map(select(.AppDisplayName != ""))
| map(select(.Source != "EntraDocs" or (
      # An Azure role: `Monitoring Reader`, `Backup Reader`.
      ($roles[.AppId] | not)
      # A Graph permission: `Files.ReadWrite.All - Application`, `Chat.Manage`.
      and (.AppDisplayName | test(" - (Delegated|Application)$") | not)
      and (.AppDisplayName | test("^[A-Z][A-Za-z0-9]*(\\.[A-Za-z0-9]+)+$") | not)
      # A Purview classifier: `Purview/sit-defn-spain-passport-number`.
      and (.AppDisplayName | startswith("Purview/sit-defn-") | not)
      # An authenticator model, by its FIDO AAGUID rather than an app id.
      and (.AppDisplayName | test("\\bfido\\b|authenticator card|security key|passkey"; "i") | not)
      # A licence: `Windows 365 Business 2 vCPU 4 GB 256 GB_1`.
      and (.AppDisplayName | test("[0-9]+ ?(min|GB|TB|vCPU)\\b") | not))))
| map({(.AppId): .AppDisplayName})
| add
