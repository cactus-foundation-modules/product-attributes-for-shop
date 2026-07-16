import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { AttributesScreen } from '@/modules/product-attributes-for-shop/components/admin/AttributesScreen'

export const metadata = { title: 'Product attributes — Admin' }

export default async function ProductAttributesPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to manage product attributes.</div>

  return <AttributesScreen />
}
