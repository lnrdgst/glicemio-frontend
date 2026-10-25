// Incluída no bundle já armazenado pela PWA, inclusive para uso offline.
import logo from '../assets/branding/glicemio-logo-title.png?inline'

export function BrandLogo() {
  return <img className="brand-logo" src={logo} alt="Glicemio" width={1200} height={291} />
}
