import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { AttributesScreen } from '@/modules/product-attributes-for-shop/components/admin/AttributesScreen'

// This screen is a tab on Shop > Catalogue rather than a sidebar link of its own.
// The permission check stays here rather than leaning on the host's: this is a
// component, and one that renders whatever it is handed is a refactor away from
// showing the screen to a role that should never reach it.
export async function AttributesTab() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to manage product attributes.</div>

  return <AttributesScreen />
}
