import { z } from "zod";
import { db } from "../../server";
import { categories as defaults } from "../../finance";
import { transaction } from "../../postgres";
import { id, parse, InputError, lockOwner } from "./common";
export async function listCategories(owner: string) {
  const data = await db()
    .prepare(
      "SELECT id,name,color,parent_id,category_type,archived FROM financial_categories WHERE user_id=? ORDER BY name",
    )
    .bind(owner)
    .all();
  return {
    categories: defaults
      .map((name) => ({
        id: "default:" + name,
        name,
        color: "#357c67",
        category_type: "both",
        archived: false,
      }))
      .concat(data.results as never[]),
  };
}
export async function saveCategory(owner: string, body: unknown) {
  const b = parse(
    z.object({
      id: id.optional(),
      name: z.string().trim().min(1).max(100),
      color: z
        .string()
        .regex(/^#[a-f\d]{6}$/i)
        .default("#357c67"),
      parentId: id.nullish(),
      type: z.enum(["expense", "income", "both"]).default("both"),
      archived: z.boolean().default(false),
    }),
    body,
  );
  const categoryId = b.id || crypto.randomUUID();
  if (categoryId.startsWith("default:"))
    throw new InputError(
      "Categorias padrão são preservadas. Crie uma categoria própria.",
    );
  await transaction(async (client) => {
    await lockOwner(client, owner);
    if (b.parentId) {
      const parent = await client.query(
        "SELECT id FROM financial_categories WHERE user_id=$1 AND id=$2 AND parent_id IS NULL",
        [owner, b.parentId],
      );
      if (!parent.rows.length || b.parentId === categoryId)
        throw new InputError("Categoria principal inválida.");
    }
    const old = await client.query(
      "SELECT name FROM financial_categories WHERE id=$1 AND user_id=$2",
      [categoryId, owner],
    );
    if (b.id && !old.rows.length)
      throw new InputError("Categoria não encontrada.", 404);
    const duplicate = await client.query(
      "SELECT id FROM financial_categories WHERE user_id=$1 AND LOWER(name)=LOWER($2) AND id<>$3",
      [owner, b.name, categoryId],
    );
    if (duplicate.rows.length || defaults.includes(b.name))
      throw new InputError("Já existe uma categoria com este nome.", 409);
    await client.query(
      "INSERT INTO financial_categories(id,user_id,name,color,parent_id,category_type,archived,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,parent_id=excluded.parent_id,category_type=excluded.category_type,archived=excluded.archived WHERE financial_categories.user_id=$2",
      [
        categoryId,
        owner,
        b.name,
        b.color,
        b.parentId || null,
        b.type,
        b.archived,
        Date.now(),
      ],
    );
    if (old.rows.length && old.rows[0].name !== b.name) {
      await client.query(
        "UPDATE records SET payload=jsonb_set(payload::jsonb,'{category}',to_jsonb($2::text))::text,updated=GREATEST(updated+1,$4) WHERE user_id=$1 AND category=$3",
        [owner, b.name, old.rows[0].name, Date.now()],
      );
      await client.query(
        "UPDATE classification_rules SET category=$2 WHERE user_id=$1 AND category=$3",
        [owner, b.name, old.rows[0].name],
      );
    }
  });
  return listCategories(owner);
}
export async function listRules(owner: string) {
  return {
    rules: (
      await db()
        .prepare(
          "SELECT id,term,category,subcategory,priority FROM classification_rules WHERE user_id=? ORDER BY priority DESC,created",
        )
        .bind(owner)
        .all()
    ).results,
  };
}
export async function saveRule(owner: string, body: unknown) {
  const b = parse(
    z.object({
      id: id.optional(),
      term: z.string().trim().min(2).max(100),
      category: z.string().trim().min(1).max(100),
      subcategory: z.string().trim().max(100).default(""),
      priority: z.number().int().min(0).max(100).default(0),
      remove: z.boolean().default(false),
    }),
    body,
  );
  if (b.remove) {
    if (!b.id) throw new InputError("Escolha uma regra.");
    await db()
      .prepare("DELETE FROM classification_rules WHERE id=? AND user_id=?")
      .bind(b.id, owner)
      .run();
  } else {
    const found = await listCategories(owner);
    if (!found.categories.some((c) => c.name === b.category && !c.archived))
      throw new InputError("Categoria inválida.");
    await db()
      .prepare(
        "INSERT INTO classification_rules(id,user_id,term,category,subcategory,priority,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET term=excluded.term,category=excluded.category,subcategory=excluded.subcategory,priority=excluded.priority WHERE classification_rules.user_id=excluded.user_id",
      )
      .bind(
        b.id || crypto.randomUUID(),
        owner,
        b.term,
        b.category,
        b.subcategory,
        b.priority,
        Date.now(),
      )
      .run();
  }
  return listRules(owner);
}
