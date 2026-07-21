import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronDown,
  X,
  House,
  LoaderCircle,
  LogOut,
  MoreVertical,
  Settings,
  ShoppingCart,
  TentTree,
  Truck,
  UsersRound,
  UtensilsCrossed
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover
} from "react-aria-components";
import { AuthCallbackPage } from "../features/auth/AuthCallbackPage";
import { useAuth } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { WorkspaceProvider, useWorkspace } from "../features/workspace/WorkspaceContext";
import { BrandMark } from "./BrandMark";
import { ContextSelect } from "./ContextSelect";
import { userFacingError } from "../lib/userFacingError";

type AppPath = "/" | "/deltagare" | "/specialkost" | "/recept" | "/matsedel" | "/inkop" | "/leveranser";

const navigation: Array<{
  label: string;
  to: AppPath;
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
}> = [
  { label: "Översikt", to: "/", icon: House },
  { label: "Deltagare", to: "/deltagare", icon: UsersRound },
  { label: "Specialkost", to: "/specialkost", icon: UtensilsCrossed },
  { label: "Recept", to: "/recept", icon: BookOpen },
  { label: "Matsedel", to: "/matsedel", icon: CalendarDays },
  { label: "Inköp", to: "/inkop", icon: ShoppingCart },
  { label: "Leveranser", to: "/leveranser", icon: Truck }
];

export function AppShell() {
  const { session, status, invitation } = useAuth();

  if (status === "loading") {
    return <main className="auth-page"><LoaderCircle className="spin" aria-label="Kontrollerar session" size={38} /></main>;
  }

  if (!session) return <LoginPage />;

  if (invitation.status !== "idle") return <AuthCallbackPage />;

  return <WorkspaceProvider><AuthenticatedAppShell /></WorkspaceProvider>;
}

function AuthenticatedAppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user, signOut } = useAuth();
  const {
    memberships,
    camps,
    activeMembership,
    activeCamp,
    setActiveOrganizationId,
    setActiveCampId,
    loading,
    error
  } = useWorkspace();
  const displayName = typeof user?.user_metadata.display_name === "string"
    ? user.user_metadata.display_name
    : user?.email?.split("@")[0] ?? "Användare";
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  if (loading && memberships.length === 0) {
    return <main className="auth-page"><LoaderCircle className="spin" aria-label="Läser organisationer" size={38} /></main>;
  }

  if (error) {
    return <main className="auth-page"><section className="auth-card auth-card--compact"><h1>Data kunde inte läsas</h1><p className="auth-card__intro">{userFacingError(new Error(error), "Organisationerna kunde inte läsas.")}</p><Button className="button-link" onPress={() => void signOut()}>Logga ut</Button></section></main>;
  }

  if (!activeMembership) {
    return <main className="auth-page"><section className="auth-card auth-card--compact"><h1>Ingen organisation</h1><p className="auth-card__intro">Kontot har inte tillgång till någon organisation. Be en administratör skicka en inbjudan.</p><Button className="button-link" onPress={() => void signOut()}>Logga ut</Button></section></main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        {pathname === "/" ? null : (
          <Link to="/" className="mobile-header-button mobile-header-button--back" aria-label="Tillbaka till översikten">
            <ArrowLeft aria-hidden="true" size={28} />
          </Link>
        )}
        <Link to="/" className="topbar__brand" aria-label="Gå till översikten">
          <BrandMark />
        </Link>
        <div className="topbar__contexts" aria-label="Aktiv organisation och aktivt läger">
          <ContextSelect
            ariaLabel="Organisation"
            name="active-organization"
            icon={<UsersRound aria-hidden="true" size={19} />}
            value={activeMembership.organizationId}
            options={memberships.map((membership) => ({ id: membership.organizationId, label: membership.organizationName }))}
            onChange={setActiveOrganizationId}
          />
          <ContextSelect
            ariaLabel="Läger"
            name="active-camp"
            icon={<TentTree aria-hidden="true" size={20} />}
            value={activeCamp?.id ?? null}
            options={camps.map((camp) => ({ id: camp.id, label: camp.name }))}
            onChange={setActiveCampId}
          />
        </div>
        <MenuTrigger>
          <Button className="profile-button" aria-label="Öppna användarmenyn">
            <span className="profile-button__avatar" aria-hidden="true">{initials}</span>
            <span className="profile-button__name">{displayName}</span>
            <ChevronDown aria-hidden="true" size={17} />
          </Button>
          <Popover className="profile-menu__popover" placement="bottom end">
            <Menu className="profile-menu" aria-label="Användarmeny">
              {activeMembership.role === "admin" ? (
                <MenuItem className="profile-menu__item" onAction={() => void navigate({ to: "/team" })}>
                  <Settings aria-hidden="true" size={18} /> Användare och behörigheter
                </MenuItem>
              ) : null}
              <MenuItem className="profile-menu__item" onAction={() => void signOut()}>
                <LogOut aria-hidden="true" size={18} /> Logga ut
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
        <DialogTrigger>
          <Button className="mobile-header-button mobile-header-button--menu" aria-label="Öppna huvudmenyn">
            <MoreVertical aria-hidden="true" size={28} />
          </Button>
          <ModalOverlay className="mobile-menu-overlay" isDismissable>
            <Modal className="mobile-menu-modal">
              <Dialog className="mobile-menu" aria-label="Huvudmeny">
                {({ close }) => (
                  <>
                    <div className="mobile-menu__heading">
                      <div className="mobile-menu__user">
                        <span className="profile-button__avatar" aria-hidden="true">{initials}</span>
                        <div><strong>{displayName}</strong><span>{activeMembership.organizationName}</span></div>
                      </div>
                      <Button autoFocus className="icon-button mobile-menu__close" aria-label="Stäng huvudmenyn" onPress={close}>
                        <X aria-hidden="true" size={25} />
                      </Button>
                    </div>

                    <div className="mobile-menu__contexts" aria-label="Aktiv organisation och aktivt läger">
                      <ContextSelect
                        ariaLabel="Organisation"
                        name="active-organization"
                        icon={<UsersRound aria-hidden="true" size={19} />}
                        value={activeMembership.organizationId}
                        options={memberships.map((membership) => ({ id: membership.organizationId, label: membership.organizationName }))}
                        onChange={setActiveOrganizationId}
                      />
                      <ContextSelect
                        ariaLabel="Läger"
                        name="active-camp"
                        icon={<TentTree aria-hidden="true" size={20} />}
                        value={activeCamp?.id ?? null}
                        options={camps.map((camp) => ({ id: camp.id, label: camp.name }))}
                        onChange={setActiveCampId}
                      />
                    </div>

                    <nav className="mobile-menu__nav" aria-label="Huvudnavigation i mobilmenyn">
                      {navigation.map(({ label, to, icon: Icon }) => (
                        <Link key={to} to={to} className="nav-link" activeProps={{ className: "nav-link nav-link--active" }} onClick={close}>
                          <Icon aria-hidden={true} size={22} strokeWidth={1.9} />
                          <span>{label}</span>
                        </Link>
                      ))}
                    </nav>

                    <div className="mobile-menu__account" aria-label="Användarmeny">
                      {activeMembership.role === "admin" ? (
                        <Link to="/team" className="mobile-menu__account-action" onClick={close}>
                          <Settings aria-hidden="true" size={20} /> Användare och behörigheter
                        </Link>
                      ) : null}
                      <Button className="mobile-menu__account-action" onPress={() => { close(); void signOut(); }}>
                        <LogOut aria-hidden="true" size={20} /> Logga ut
                      </Button>
                    </div>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </DialogTrigger>
      </header>

      <aside className="sidebar" aria-label="Huvudnavigation">
        <nav className="sidebar__nav">
          {navigation.map(({ label, to, icon: Icon }) => (
            <Link key={to} to={to} className="nav-link" activeProps={{ className: "nav-link nav-link--active" }}>
              <Icon aria-hidden={true} size={22} strokeWidth={1.9} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="main-content" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
