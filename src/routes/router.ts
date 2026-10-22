export type Route = 'landing' | 'demo' | 'demo-emails' | 'app' | 'review' | 'emails' | 'about' | 'error';

/** Hash routing: `#/`, `#/demo`, `#/demo/emails`, `#/app`, `#/review`, `#/emails`, `#/about`, `#/error`. Unknown hashes fall back to the landing page. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  switch (path) {
    case '/demo': return 'demo';
    case '/demo/emails': return 'demo-emails';
    case '/app': return 'app';
    case '/review': return 'review';
    case '/emails': return 'emails';
    case '/about': return 'about';
    case '/error': return 'error';
    default: return 'landing';
  }
}

const HASH: Record<Route, string> = {
  landing: '#/', demo: '#/demo', 'demo-emails': '#/demo/emails', app: '#/app', review: '#/review', emails: '#/emails', about: '#/about', error: '#/error',
};

export function go(route: Route): void {
  window.location.hash = HASH[route];
}

/**
 * DC-098 (FB-54): where the header logo goes. The demo goes to its start (its review); signed in, the scan screen (which
 * shows the finished scan, never a new one); otherwise the landing page.
 */
export function homeRoute(route: Route, signedIn: boolean): Route {
  if (route === 'demo' || route === 'demo-emails') return 'demo';
  return signedIn ? 'app' : 'landing';
}

/** The hash for a route, for links (DC-098: the logo). */
export function hrefOf(route: Route): string {
  return HASH[route];
}
