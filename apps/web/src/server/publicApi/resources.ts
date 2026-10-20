// M13 RG-M13-36/37 — ressources de l'API publique v1 : sérialisation snake_case, montants FCFA
// entiers, dates AAAA-MM-JJ, horodatages ISO 8601 UTC (RG-M13-35). `external_id` relie un
// enregistrement à son identifiant dans le logiciel de l'intégrateur (`ExternalRef`, source =
// nom de la clé par défaut). Les écritures émettent les mêmes événements que l'application.
import {
  ApiError,
  clampLimit,
  computeDisplayName,
  decodeCursor,
  normalizePhoneCI,
  normalizePlate,
  pageOf,
  parseUpdatedSince,
} from "@atelieros/core";
import {
  adminDb,
  writeAuditLog,
  type Customer,
  type Invoice,
  type InvoiceLine,
  type Payment,
  type Prisma,
  type ScopedTenantClient,
  type Vehicle,
} from "@atelieros/db";
import {
  apiCustomerCreateSchema,
  apiCustomerPatchSchema,
  apiVehicleCreateSchema,
  type ApiCustomerCreate,
  type ApiCustomerPatch,
} from "@atelieros/validators";
import { notFound, parseBody, type ApiContext, type ApiResult } from "./http";

type Tx = ScopedTenantClient;
/** Le client locataire hors transaction expose les mêmes délégués que celui d'une transaction. */
const tdb = (ctx: ApiContext) => ctx.tenantDb as unknown as Tx;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function phoneOrError(value: string | null | undefined, field: string): string | null {
  if (!value) return null;
  try {
    const result = normalizePhoneCI(value);
    if (result.status === "OK" && result.e164) return result.e164;
  } catch {
    // ignoré : erreur ci-dessous
  }
  throw new ApiError(422, "validation_failed", "Téléphone invalide.", [
    { field, issue: "Numéro de téléphone ivoirien attendu (ex. 07 47 21 88 90)." },
  ]);
}

/** Pagination par (horodatage, id) croissants : `limit + 1` lignes lues. */
function cursorWhere(field: "updatedAt" | "createdAt", raw: string | null) {
  const cursor = decodeCursor(raw);
  if (!cursor) return {};
  const at = new Date(cursor.at);
  return { OR: [{ [field]: { gt: at } }, { [field]: at, id: { gt: cursor.id } }] };
}

async function audit(
  ctx: ApiContext,
  action: string,
  entity: string,
  entityId: string,
  after: unknown,
) {
  await writeAuditLog({
    organizationId: ctx.organizationId,
    action,
    entity,
    entityId,
    after: after as object,
    reason: `api_key:${ctx.apiKey.prefix}`,
  });
}

// ───────────── ExternalRef (RG-M13-36) ─────────────

async function apiDataSource(tx: Tx, organizationId: string, name: string) {
  const existing = await tx.dataSource.findFirst({ where: { type: "REST_API", name } });
  if (existing) return existing;
  return tx.dataSource.create({
    data: { organizationId, type: "REST_API", name, config: "{}", isActive: true },
  });
}

async function externalTarget(
  tx: Tx,
  ctx: ApiContext,
  entity: string,
  externalId: string,
  source: string | undefined,
): Promise<string | null> {
  const ds = await apiDataSource(tx, ctx.organizationId, source ?? ctx.apiKey.name);
  const ref = await tx.externalRef.findFirst({
    where: { dataSourceId: ds.id, entity, externalId },
  });
  return ref?.internalId ?? null;
}

async function linkExternal(
  tx: Tx,
  ctx: ApiContext,
  entity: string,
  externalId: string | undefined,
  source: string | undefined,
  internalId: string,
) {
  if (!externalId) return;
  const ds = await apiDataSource(tx, ctx.organizationId, source ?? ctx.apiKey.name);
  const existing = await tx.externalRef.findFirst({
    where: { dataSourceId: ds.id, entity, externalId },
  });
  if (existing && existing.internalId !== internalId) {
    throw new ApiError(
      409,
      "conflict",
      `external_id « ${externalId} » déjà lié à un autre enregistrement.`,
    );
  }
  if (!existing) {
    await tx.externalRef.create({
      data: {
        organizationId: ctx.organizationId,
        dataSourceId: ds.id,
        entity,
        externalId,
        internalId,
        lastSeenAt: ctx.now,
      },
    });
  }
}

async function externalIdsOf(tx: Tx, entity: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const refs = await tx.externalRef.findMany({
    where: { entity, internalId: { in: ids } },
    orderBy: { id: "asc" },
  });
  return new Map(refs.map((r) => [r.internalId, r.externalId]));
}

// ───────────── Clients ─────────────

export function serializeCustomer(c: Customer, externalId: string | null = null) {
  return {
    id: c.id,
    type: c.type.toLowerCase(),
    display_name: c.displayName,
    first_name: c.firstName,
    last_name: c.lastName,
    company_name: c.companyName,
    phone: c.phone,
    whatsapp_phone: c.whatsappPhone,
    email: c.email,
    address: c.address,
    commune: c.commune,
    ncc: c.ncc,
    rccm: c.rccm,
    payment_terms_days: c.paymentTermsDays,
    origin: c.origin.toLowerCase(),
    external_id: externalId,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

export async function listCustomers(ctx: ApiContext): Promise<ApiResult> {
  const q = ctx.url.searchParams;
  const limit = clampLimit(q.get("limit"));
  const since = parseUpdatedSince(q.get("updated_since"));
  const phone = q.get("phone") ? phoneOrError(q.get("phone"), "phone") : null;
  const rows = await ctx.tenantDb.customer.findMany({
    where: {
      deletedAt: null,
      ...(since ? { updatedAt: { gte: since } } : {}),
      ...(phone ? { OR: [{ phone }, { phone2: phone }, { whatsappPhone: phone }] } : {}),
      ...cursorWhere("updatedAt", q.get("cursor")),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (r) => r.updatedAt);
  const refs = await externalIdsOf(
    tdb(ctx),
    "customers",
    page.data.map((c) => c.id),
  );
  return {
    status: 200,
    body: {
      data: page.data.map((c) => serializeCustomer(c, refs.get(c.id) ?? null)),
      next_cursor: page.next_cursor,
    },
  };
}

async function loadCustomer(tx: Tx, id: string) {
  const customer = await tx.customer.findFirst({ where: { id, deletedAt: null } });
  if (!customer) notFound("Client");
  return customer;
}

export async function getCustomer(ctx: ApiContext): Promise<ApiResult> {
  const customer = await loadCustomer(tdb(ctx), ctx.params.id!);
  const refs = await externalIdsOf(tdb(ctx), "customers", [customer.id]);
  return { status: 200, body: serializeCustomer(customer, refs.get(customer.id) ?? null) };
}

function customerData(input: ApiCustomerCreate | ApiCustomerPatch, current?: Customer) {
  const type = current?.type ?? ("type" in input ? input.type : undefined) ?? "INDIVIDUAL";
  const lastName = input.last_name !== undefined ? input.last_name : current?.lastName;
  const firstName = input.first_name !== undefined ? input.first_name : current?.firstName;
  const companyName = input.company_name !== undefined ? input.company_name : current?.companyName;
  const data: Prisma.CustomerUncheckedUpdateInput = {
    displayName:
      type === "COMPANY"
        ? computeDisplayName({ type: "COMPANY", companyName: companyName ?? "" })
        : computeDisplayName({
            type: "INDIVIDUAL",
            lastName: lastName ?? "",
            firstName: firstName ?? undefined,
          }),
  };
  if (input.first_name !== undefined) data.firstName = input.first_name;
  if (input.last_name !== undefined) data.lastName = input.last_name;
  if (input.company_name !== undefined) data.companyName = input.company_name;
  if (input.phone !== undefined) data.phone = phoneOrError(input.phone, "phone");
  if (input.whatsapp_phone !== undefined) {
    data.whatsappPhone = phoneOrError(input.whatsapp_phone, "whatsapp_phone");
  }
  if (input.email !== undefined) data.email = input.email;
  if (input.address !== undefined) data.address = input.address;
  if (input.commune !== undefined) data.commune = input.commune;
  if (input.ncc !== undefined) data.ncc = input.ncc;
  if (input.rccm !== undefined) data.rccm = input.rccm;
  if (input.payment_terms_days !== undefined) data.paymentTermsDays = input.payment_terms_days;
  if (input.notes !== undefined) data.notes = input.notes;
  return data;
}

async function createCustomerRecord(ctx: ApiContext, tx: Tx, input: ApiCustomerCreate) {
  const data = customerData(input);
  const customer = await tx.customer.create({
    data: {
      ...(data as Prisma.CustomerUncheckedCreateInput),
      organizationId: ctx.organizationId,
      type: input.type,
      origin: "API",
      source: "api",
      consentUpdatedAt: ctx.now,
      consentSource: "api",
    },
  });
  await linkExternal(tx, ctx, "customers", input.external_id, input.source, customer.id);
  await tx.domainEvent.create({
    data: {
      organizationId: ctx.organizationId,
      type: "customer.created",
      payload: { customerId: customer.id, type: customer.type, origin: "API" },
      occurredAt: ctx.now,
    },
  });
  return customer;
}

async function updateCustomerRecord(
  ctx: ApiContext,
  tx: Tx,
  current: Customer,
  input: ApiCustomerPatch,
) {
  const customer = await tx.customer.update({
    where: { id: current.id },
    data: customerData(input, current),
  });
  await linkExternal(tx, ctx, "customers", input.external_id, input.source, customer.id);
  await tx.domainEvent.create({
    data: {
      organizationId: ctx.organizationId,
      type: "customer.updated",
      payload: { customerId: customer.id, origin: "API" },
      occurredAt: ctx.now,
    },
  });
  return customer;
}

export async function createCustomer(ctx: ApiContext): Promise<ApiResult> {
  const input = parseBody(apiCustomerCreateSchema, ctx.body);
  const customer = await ctx.tenantDb.transaction(async (tx) => {
    if (input.external_id) {
      const existing = await externalTarget(tx, ctx, "customers", input.external_id, input.source);
      if (existing) {
        throw new ApiError(
          409,
          "conflict",
          `external_id « ${input.external_id} » existe déjà : utilisez PUT /api/v1/customers/by-external-id/${input.external_id}.`,
        );
      }
    }
    return createCustomerRecord(ctx, tx, input);
  });
  await audit(ctx, "customer.created", "Customer", customer.id, { origin: "API" });
  return { status: 201, body: serializeCustomer(customer, input.external_id ?? null) };
}

export async function patchCustomer(ctx: ApiContext): Promise<ApiResult> {
  const input = parseBody(apiCustomerPatchSchema, ctx.body);
  const customer = await ctx.tenantDb.transaction(async (tx) =>
    updateCustomerRecord(ctx, tx, await loadCustomer(tx, ctx.params.id!), input),
  );
  await audit(ctx, "customer.updated", "Customer", customer.id, { origin: "API" });
  const refs = await externalIdsOf(tdb(ctx), "customers", [customer.id]);
  return { status: 200, body: serializeCustomer(customer, refs.get(customer.id) ?? null) };
}

/** `PUT /api/v1/customers/by-external-id/{eid}` — upsert (RG-M13-36). */
export async function upsertCustomerByExternalId(ctx: ApiContext): Promise<ApiResult> {
  const externalId = ctx.params.externalId!;
  const raw = (ctx.body ?? {}) as Record<string, unknown>;
  const result = await ctx.tenantDb.transaction(async (tx) => {
    const source = typeof raw.source === "string" ? raw.source : undefined;
    const targetId = await externalTarget(tx, ctx, "customers", externalId, source);
    if (targetId) {
      const input = parseBody(apiCustomerPatchSchema, { ...raw, external_id: externalId });
      delete (input as { type?: unknown }).type;
      return {
        created: false,
        customer: await updateCustomerRecord(ctx, tx, await loadCustomer(tx, targetId), input),
      };
    }
    const input = parseBody(apiCustomerCreateSchema, { ...raw, external_id: externalId });
    return { created: true, customer: await createCustomerRecord(ctx, tx, input) };
  });
  await audit(
    ctx,
    result.created ? "customer.created" : "customer.updated",
    "Customer",
    result.customer.id,
    { origin: "API", externalId },
  );
  return {
    status: result.created ? 201 : 200,
    body: serializeCustomer(result.customer, externalId),
  };
}

export async function customerBalance(ctx: ApiContext): Promise<ApiResult> {
  const customer = await loadCustomer(tdb(ctx), ctx.params.id!);
  const open = await ctx.tenantDb.invoice.findMany({
    where: {
      customerId: customer.id,
      billTo: "CUSTOMER",
      status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] },
      balance: { gt: 0 },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  return {
    status: 200,
    body: {
      customer_id: customer.id,
      balance: open.reduce((s, i) => s + i.balance, 0),
      open_invoices: open.map((i) => ({
        id: i.id,
        number: i.externalNumber ?? i.number,
        due_date: day(i.dueDate),
        total: i.total,
        balance: i.balance,
        status: i.status.toLowerCase(),
      })),
    },
  };
}

// ───────────── Véhicules ─────────────

export function serializeVehicle(v: Vehicle, externalId: string | null = null) {
  return {
    id: v.id,
    customer_id: v.customerId,
    plate: v.plate,
    make: v.make,
    model: v.model,
    year: v.year,
    vin: v.vin,
    color: v.color,
    current_mileage: v.currentMileage,
    inspection_expiry_date: day(v.inspectionExpiryDate),
    next_service_due_date: day(v.nextServiceDueDate),
    external_id: externalId,
    created_at: iso(v.createdAt),
    updated_at: iso(v.updatedAt),
  };
}

export async function listVehicles(ctx: ApiContext): Promise<ApiResult> {
  const q = ctx.url.searchParams;
  const limit = clampLimit(q.get("limit"));
  const since = parseUpdatedSince(q.get("updated_since"));
  const plate = q.get("plate");
  const expiryBefore = q.get("inspection_expiry_before");
  if (expiryBefore && !/^\d{4}-\d{2}-\d{2}$/.test(expiryBefore)) {
    throw new ApiError(
      400,
      "validation_failed",
      "inspection_expiry_before : date AAAA-MM-JJ attendue.",
    );
  }
  const rows = await ctx.tenantDb.vehicle.findMany({
    where: {
      deletedAt: null,
      ...(since ? { updatedAt: { gte: since } } : {}),
      ...(plate ? { plateCompact: normalizePlate(plate).plateCompact } : {}),
      ...(q.get("customer_id") ? { customerId: q.get("customer_id")! } : {}),
      ...(expiryBefore
        ? { inspectionExpiryDate: { lt: new Date(`${expiryBefore}T00:00:00Z`) } }
        : {}),
      ...cursorWhere("updatedAt", q.get("cursor")),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (r) => r.updatedAt);
  const refs = await externalIdsOf(
    tdb(ctx),
    "vehicles",
    page.data.map((v) => v.id),
  );
  return {
    status: 200,
    body: {
      data: page.data.map((v) => serializeVehicle(v, refs.get(v.id) ?? null)),
      next_cursor: page.next_cursor,
    },
  };
}

export async function getVehicle(ctx: ApiContext): Promise<ApiResult> {
  const vehicle = await ctx.tenantDb.vehicle.findFirst({
    where: { id: ctx.params.id!, deletedAt: null },
  });
  if (!vehicle) notFound("Véhicule");
  const refs = await externalIdsOf(tdb(ctx), "vehicles", [vehicle.id]);
  return { status: 200, body: serializeVehicle(vehicle, refs.get(vehicle.id) ?? null) };
}

export async function createVehicle(ctx: ApiContext): Promise<ApiResult> {
  const input = parseBody(apiVehicleCreateSchema, ctx.body);
  let normalized;
  try {
    normalized = normalizePlate(input.plate);
  } catch {
    throw new ApiError(422, "validation_failed", "Plaque invalide.", [
      { field: "plate", issue: "invalid" },
    ]);
  }
  const vehicle = await ctx.tenantDb.transaction(async (tx) => {
    await loadCustomer(tx, input.customer_id);
    const duplicate = await tx.vehicle.findFirst({
      where: { plateCompact: normalized.plateCompact, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(
        409,
        "conflict",
        `Plaque ${normalized.plate} déjà enregistrée (véhicule ${duplicate.id}).`,
      );
    }
    const created = await tx.vehicle.create({
      data: {
        organizationId: ctx.organizationId,
        customerId: input.customer_id,
        plate: normalized.plate,
        plateCompact: normalized.plateCompact,
        make: input.make,
        model: input.model,
        year: input.year ?? null,
        vin: input.vin ?? null,
        color: input.color ?? null,
        currentMileage: input.current_mileage ?? null,
        currentMileageAt: input.current_mileage != null ? ctx.now : null,
        inspectionExpiryDate: input.inspection_expiry_date
          ? new Date(`${input.inspection_expiry_date}T00:00:00Z`)
          : null,
      },
    });
    await linkExternal(tx, ctx, "vehicles", input.external_id, input.source, created.id);
    await tx.domainEvent.create({
      data: {
        organizationId: ctx.organizationId,
        type: "vehicle.created",
        payload: { vehicleId: created.id, customerId: created.customerId, origin: "API" },
        occurredAt: ctx.now,
      },
    });
    return created;
  });
  await audit(ctx, "vehicle.created", "Vehicle", vehicle.id, { origin: "API" });
  return { status: 201, body: serializeVehicle(vehicle, input.external_id ?? null) };
}

// ───────────── Factures et paiements (lecture) ─────────────

export function serializeInvoice(i: Invoice, lines?: InvoiceLine[]) {
  return {
    id: i.id,
    number: i.externalNumber ?? i.number,
    type: i.type.toLowerCase(),
    status: i.status.toLowerCase(),
    customer_id: i.customerId,
    vehicle_id: i.vehicleId,
    repair_order_id: i.repairOrderId,
    issued_at: iso(i.issuedAt),
    due_date: day(i.dueDate),
    subtotal: i.subtotal,
    discount_total: i.discountTotal,
    vat_total: i.vatTotal,
    total: i.total,
    amount_paid: i.amountPaid,
    balance: i.balance,
    fne_status: i.fneStatus.toLowerCase(),
    fne_number: i.fneNumber,
    origin: i.origin.toLowerCase(),
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
    ...(lines
      ? {
          lines: lines.map((l) => ({
            id: l.id,
            type: l.type.toLowerCase(),
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unitPrice,
            discount_rate: l.discountRate,
            vat_rate: l.vatRate,
            subtotal: l.lineSubtotal,
            vat: l.lineVat,
            total: l.lineTotal,
          })),
        }
      : {}),
  };
}

const INVOICE_STATUSES = new Set([
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
  "WRITTEN_OFF",
  "DISPUTED",
]);

export async function listInvoices(ctx: ApiContext): Promise<ApiResult> {
  const q = ctx.url.searchParams;
  const limit = clampLimit(q.get("limit"));
  const since = parseUpdatedSince(q.get("updated_since"));
  const status = q.get("status")?.toUpperCase();
  if (status && !INVOICE_STATUSES.has(status)) {
    throw new ApiError(400, "validation_failed", "Statut de facture inconnu.", [
      { field: "status", issue: "invalid" },
    ]);
  }
  const dueBefore = q.get("due_before");
  if (dueBefore && !/^\d{4}-\d{2}-\d{2}$/.test(dueBefore)) {
    throw new ApiError(400, "validation_failed", "due_before : date AAAA-MM-JJ attendue.");
  }
  const rows = await ctx.tenantDb.invoice.findMany({
    where: {
      status: status ? (status as Invoice["status"]) : { not: "DRAFT" },
      ...(q.get("customer_id") ? { customerId: q.get("customer_id")! } : {}),
      ...(dueBefore ? { dueDate: { lt: new Date(`${dueBefore}T00:00:00Z`) } } : {}),
      ...(since ? { updatedAt: { gte: since } } : {}),
      ...cursorWhere("updatedAt", q.get("cursor")),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (r) => r.updatedAt);
  return {
    status: 200,
    body: { data: page.data.map((i) => serializeInvoice(i)), next_cursor: page.next_cursor },
  };
}

export async function getInvoice(ctx: ApiContext): Promise<ApiResult> {
  const invoice = await ctx.tenantDb.invoice.findFirst({
    where: { id: ctx.params.id!, status: { not: "DRAFT" } },
    include: { lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  if (!invoice) notFound("Facture");
  return { status: 200, body: serializeInvoice(invoice, invoice.lines) };
}

export function serializePayment(
  p: Payment & { allocations?: { invoiceId: string; amount: number }[] },
) {
  return {
    id: p.id,
    number: p.number,
    customer_id: p.customerId,
    method: p.method.toLowerCase(),
    amount: p.amount,
    unallocated: p.unallocated,
    status: p.status.toLowerCase(),
    reference: p.reference,
    received_at: iso(p.receivedAt),
    voided_at: iso(p.voidedAt),
    origin: p.origin.toLowerCase(),
    allocations: (p.allocations ?? []).map((a) => ({ invoice_id: a.invoiceId, amount: a.amount })),
    created_at: iso(p.createdAt),
  };
}

export async function listPayments(ctx: ApiContext): Promise<ApiResult> {
  const q = ctx.url.searchParams;
  const limit = clampLimit(q.get("limit"));
  const since = parseUpdatedSince(q.get("updated_since"));
  const rows = await ctx.tenantDb.payment.findMany({
    where: {
      ...(q.get("customer_id") ? { customerId: q.get("customer_id")! } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
      ...cursorWhere("createdAt", q.get("cursor")),
    },
    include: {
      allocations: { where: { voidedAt: null }, select: { invoiceId: true, amount: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (r) => r.createdAt);
  return {
    status: 200,
    body: { data: page.data.map((p) => serializePayment(p)), next_cursor: page.next_cursor },
  };
}

// ───────────── Me ─────────────

export async function me(ctx: ApiContext): Promise<ApiResult> {
  // `Organization` n'a pas de colonne organizationId : lecture par id (celui de la clé).
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { id: true, name: true, plan: true },
  });
  return {
    status: 200,
    body: {
      organization: { id: org.id, name: org.name, plan: org.plan.toLowerCase() },
      api_key: {
        name: ctx.apiKey.name,
        prefix: ctx.apiKey.prefix,
        environment: ctx.apiKey.environment,
        scopes: ctx.apiKey.scopes,
        expires_at: iso(ctx.apiKey.expiresAt),
      },
      rate_limit: { requests_per_minute: ctx.plan.quotas.apiRatePerMinute },
    },
  };
}
