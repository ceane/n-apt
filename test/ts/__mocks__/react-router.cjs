const React = require("react");

const RouterContext = React.createContext(null);

const normalizeLocation = (entry) => {
  const value = typeof entry === "string" ? entry : entry?.pathname || "/";
  const [pathname, search = ""] = value.split("?");
  return {
    pathname: pathname || "/",
    search: search ? `?${search}` : "",
    hash: "",
  };
};

const MemoryRouter = ({ initialEntries = ["/"], children }) => {
  const [location, setLocation] = React.useState(() =>
    normalizeLocation(initialEntries[0]),
  );
  const navigate = React.useCallback((to, options = {}) => {
    const next = normalizeLocation(to);
    setLocation(next);
    if (typeof window !== "undefined" && options.replace !== false) {
      window.history.replaceState({}, "", `${next.pathname}${next.search}`);
    }
  }, []);

  return React.createElement(
    RouterContext.Provider,
    { value: { location, navigate } },
    children,
  );
};

const BrowserRouter = ({ children }) =>
  React.createElement(MemoryRouter, {
    initialEntries: [
      typeof window !== "undefined" ? window.location.pathname : "/",
    ],
    children,
  });

const useRouter = () => {
  const context = React.useContext(RouterContext);
  if (!context) throw new Error("Router context is required");
  return context;
};

const useLocation = () => useRouter().location;
const useNavigate = () => useRouter().navigate;

const matchRoute = (pattern, pathname) => {
  if (pattern === "*" || pattern === "*?") return {};
  const patternParts = pattern.replace(/^\//, "").split("/");
  const pathParts = pathname.replace(/^\//, "").split("/");
  if (pattern === "/" && pathname === "/") return {};
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
};

const Route = () => null;

const Routes = ({ children }) => {
  const { location } = useRouter();
  const routeElements = React.Children.toArray(children);
  const match = routeElements
    .map((child) => {
      if (!child || child.type !== Route) return null;
      const params = matchRoute(child.props.path || "*", location.pathname);
      return params ? { element: child.props.element, params } : null;
    })
    .find(Boolean);

  if (!match) return null;
  return React.createElement(
    RouterContext.Provider,
    { value: { ...useRouter(), params: match.params } },
    match.element,
  );
};

const useParams = () => useRouter().params || {};

const Link = ({ to, children, onClick, ...props }) => {
  const navigate = useNavigate();
  const href = typeof to === "string" ? to : to?.pathname || "/";
  return React.createElement(
    "a",
    {
      ...props,
      href,
      onClick: (event) => {
        onClick?.(event);
        if (!event.defaultPrevented && event.button === 0) {
          event.preventDefault();
          navigate(href);
        }
      },
    },
    children,
  );
};

const NavLink = Link;
const Navigate = ({ to, replace = false }) => {
  const navigate = useNavigate();
  React.useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
};

const Outlet = () => null;

module.exports = {
  BrowserRouter,
  Link,
  MemoryRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
};
