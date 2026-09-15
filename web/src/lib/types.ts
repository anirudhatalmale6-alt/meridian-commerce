export type Role = 'CUSTOMER' | 'ADMIN';

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_RECEIVED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  createdAt: string;
}

export interface Address {
  id: string;
  label: string | null;
  fullName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface OptionValue {
  id: string;
  value: string;
}

export interface ProductOption {
  id: string;
  name: string;
  values: OptionValue[];
}

export interface Variant {
  id: string;
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  stock: number;
  inStock: boolean;
  optionValueIds: string[];
  label: string;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string;
  brand: string | null;
  category: { slug: string; name: string } | null;
  images: { url: string; alt: string }[];
  options: ProductOption[];
  variants: Variant[];
  priceFromCents: number;
  priceToCents: number;
  totalStock: number;
  variantCount: number;
}

export interface ProductList {
  items: Product[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  sortedWithinPageOnly: boolean;
}

export interface CartItem {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  variantLabel: string;
  sku: string;
  unitCents: number;
  quantity: number;
  lineCents: number;
  stock: number;
  image: string | null;
}

export interface Cart {
  id: string;
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  currency: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  productTitle: string;
  variantLabel: string;
  sku: string;
  unitCents: number;
  quantity: number;
  lineCents: number;
}

export interface OrderEvent {
  id: string;
  from: OrderStatus | null;
  to: OrderStatus;
  note: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  method: 'BANK_TRANSFER';
  paymentReference: string;
  paidAt: string | null;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  shipFullName: string;
  shipLine1: string;
  shipLine2: string | null;
  shipCity: string;
  shipRegion: string | null;
  shipPostalCode: string;
  shipCountry: string;
  shipPhone: string | null;
  customerNote: string | null;
  createdAt: string;
  items: OrderItem[];
  events: OrderEvent[];
  user?: { id: string; email: string; name: string };
}

export interface BankPayment {
  method: 'BANK_TRANSFER';
  reference: string;
  amountCents: number;
  currency: string;
  bank: {
    accountName: string;
    accountNumber: string;
    sortCode: string;
    iban: string;
    swift: string;
  };
  instructions?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  productCount: number;
}

export interface Facets {
  brands: string[];
  minPriceCents: number;
  maxPriceCents: number;
}

export interface AdminStats {
  orderCount: number;
  awaitingPayment: number;
  customers: number;
  productCount: number;
  paidRevenueCents: number;
  lowStockVariants: number;
}
