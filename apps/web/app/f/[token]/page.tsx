import { notFound } from "next/navigation";

async function getForm(token: string) {
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/public/forms/${token}`, { cache: "no-store" });
  if (!res.ok) notFound();
  return res.json();
}

export default async function PublicForm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = (await getForm(token)) as { id: string; name: string; fields: Array<{ key: string; label: string; type: string; required?: boolean }> };

  async function submit(formData: FormData) {
    "use server";
    const values: Record<string, string> = {};
    for (const f of form.fields) values[f.key] = String(formData.get(f.key) ?? "");
    const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    const res = await fetch(`${base}/public/forms/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error("Submission failed — check required fields");
  }

  return (
    <main className="main">
      <div className="card">
        <h2>{form.name}</h2>
        <form action={submit}>
          {form.fields.map((f) => (
            <p key={f.key}>
              <label>
                {f.label}
                {f.required ? " *" : ""}
                <br />
                {f.type === "textarea" ? (
                  <textarea name={f.key} rows={3} cols={50} required={f.required} />
                ) : (
                  <input name={f.key} type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"} required={f.required} />
                )}
              </label>
            </p>
          ))}
          <button type="submit">Submit</button>
        </form>
      </div>
    </main>
  );
}
