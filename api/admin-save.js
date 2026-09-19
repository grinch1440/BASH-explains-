// Vercel serverless function: POST /api/admin-save
// Verifies the admin password, then reads data.json from GitHub, applies
// the add/update/delete, and commits it back — which triggers Vercel's
// GitHub integration to auto-redeploy the site with the change live.
//
// Required environment variables (set in Vercel → Settings → Environment Variables):
//   ADMIN_PASSWORD   - the password you'll type into the admin page
//   GITHUB_TOKEN     - a GitHub personal access token with "Contents: read and write"
//                      permission on this one repo (see PAYSTACK_SETUP.md-style guide)
//   GITHUB_OWNER     - your GitHub username, e.g. "grinch1440"
//   GITHUB_REPO      - the repo name, e.g. "BASH-explains-"
//   GITHUB_BRANCH    - optional, defaults to "main"

const VALID_ACTIONS = [
  "upsert",
  "delete",
  "updatePrivacyPolicy",
  "deleteCategory",
  "renameCategory",
  "createCategory",
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

  if (!ADMIN_PASSWORD || !GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({
      error:
        "Admin dashboard isn't fully configured yet — missing one of ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO.",
    });
  }

  const { password, action, explainer, id, newCategory, html, categoryName, oldName, newName } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "Invalid action." });
  }
  if (action === "upsert" && (!explainer || !explainer.id || !explainer.title)) {
    return res.status(400).json({ error: "Explainer is missing required fields." });
  }
  if (action === "delete" && !id) {
    return res.status(400).json({ error: "Missing id to delete." });
  }
  if (action === "updatePrivacyPolicy" && typeof html !== "string") {
    return res.status(400).json({ error: "Missing privacy policy content." });
  }
  if (action === "deleteCategory" && !categoryName) {
    return res.status(400).json({ error: "Missing category name to delete." });
  }
  if (action === "renameCategory" && (!oldName || !newName)) {
    return res.status(400).json({ error: "Missing old or new category name." });
  }
  if (action === "createCategory" && (!newCategory || !newCategory.name)) {
    return res.status(400).json({ error: "Missing new category name." });
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data.json`;
  const ghHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    // Step 1: fetch the current data.json and its sha (needed to commit an update).
    const getRes = await fetch(`${apiBase}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
    if (!getRes.ok) {
      const errBody = await getRes.text();
      return res.status(502).json({ error: `Could not read data.json from GitHub: ${errBody}` });
    }
    const getData = await getRes.json();
    const currentContent = Buffer.from(getData.content, "base64").toString("utf-8");
    const data = JSON.parse(currentContent);

    // Step 2: apply the change.
    if (action === "delete") {
      data.explainers = data.explainers.filter((e) => e.id !== id);
    } else if (action === "updatePrivacyPolicy") {
      data.privacyPolicyHtml = html;
      data.privacyPolicyUpdated = new Date().toISOString();
    } else if (action === "deleteCategory") {
      const inUse = data.explainers.filter((e) => e.category === categoryName).length;
      if (inUse > 0) {
        return res.status(400).json({
          error: `Can't delete "${categoryName}" — ${inUse} explainer(s) still use it.`,
        });
      }
      data.categories = data.categories.filter((c) => c.name !== categoryName);
    } else if (action === "renameCategory") {
      if (!data.categories.some((c) => c.name === oldName)) {
        return res.status(404).json({ error: `Category "${oldName}" not found.` });
      }
      if (data.categories.some((c) => c.name === newName)) {
        return res.status(400).json({ error: `A category called "${newName}" already exists.` });
      }
      data.categories = data.categories.map((c) => (c.name === oldName ? { ...c, name: newName } : c));
      data.explainers = data.explainers.map((e) => (e.category === oldName ? { ...e, category: newName } : e));
    } else if (action === "createCategory") {
      const alreadyExists = data.categories.some((c) => c.name === newCategory.name);
      if (alreadyExists) {
        return res.status(400).json({ error: `A category called "${newCategory.name}" already exists.` });
      }
      const color = newCategory.color || "slate";
      data.categories.push({
        name: newCategory.name,
        light: `bg-${color}-100 text-${color}-800`,
        dark: `bg-${color}-900/40 text-${color}-300`,
      });
    } else {
      // action === "upsert"
      // If this explainer is marked featured, unfeature every other one first.
      if (explainer.featured) {
        data.explainers = data.explainers.map((e) => ({ ...e, featured: false }));
      }
      const idx = data.explainers.findIndex((e) => e.id === explainer.id);
      if (idx >= 0) {
        data.explainers[idx] = explainer;
      } else {
        data.explainers.push(explainer);
      }
      if (newCategory && newCategory.name) {
        const alreadyExists = data.categories.some((c) => c.name === newCategory.name);
        if (!alreadyExists) {
          const color = newCategory.color || "slate";
          data.categories.push({
            name: newCategory.name,
            light: `bg-${color}-100 text-${color}-800`,
            dark: `bg-${color}-900/40 text-${color}-300`,
          });
        }
      }
    }

    // Step 3: commit the updated data.json back to GitHub.
    const newContentBase64 = Buffer.from(JSON.stringify(data, null, 2), "utf-8").toString("base64");
    const commitMessages = {
      delete: `Admin: delete explainer ${id}`,
      updatePrivacyPolicy: "Admin: update privacy policy",
      deleteCategory: `Admin: delete category ${categoryName}`,
      renameCategory: `Admin: rename category ${oldName} -> ${newName}`,
      createCategory: `Admin: create category ${newCategory && newCategory.name}`,
      upsert: `Admin: ${explainer && explainer.id ? "update" : "add"} explainer ${explainer && explainer.id}`,
    };
    const commitMessage = commitMessages[action];

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify({
        message: commitMessage,
        content: newContentBase64,
        sha: getData.sha,
        branch: GITHUB_BRANCH,
      }),
    });

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return res.status(502).json({ error: `Could not save to GitHub: ${errBody}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Unexpected server error while saving." });
  }
}
