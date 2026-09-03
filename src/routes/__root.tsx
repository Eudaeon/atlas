import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"

import { themeScript } from "@/components/theme-toggle"
import { Toaster } from "@/components/ui/toast"

import appCss from "../styles.css?url"

const description =
  "An application that reads Microsoft Entra sign-in and audit log " +
  "exports and puts them on a map. Source code is available at " +
  "https://github.com/Eudaeon/atlas"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Atlas" },
      { name: "description", content: description },
      { name: "author", content: "Eudaeon" },
      { name: "application-name", content: "Atlas" },
      // Link previews. Nothing names the origin the build is deployed to, so
      // there is no absolute og:url to hang on it and the image is left
      // relative for the scraper to resolve.
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Atlas" },
      { property: "og:title", content: "Atlas" },
      { property: "og:description", content: description },
      { property: "og:image", content: "/logo512.png" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // The .ico carries the small sizes Windows and the bookmark bar ask for;
      // everything else takes the PNG.
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", href: "/logo192.png" },
      { rel: "apple-touch-icon", href: "/logo192.png" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Toaster />
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
