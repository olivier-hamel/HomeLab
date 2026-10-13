import { MongoClient } from "mongodb";
import { MediaError } from "./media/core.ts";

// Calendar and cinema repositories share one pool, never a connection per request.
let connection: Promise<MongoClient> | null = null;
export function mongoUri() {
  const template = process.env.MONGODB_URI?.trim();
  if (!template) throw new MediaError("database_setup", "Configure MONGODB_URI dans backend/.env pour enregistrer les données HomeLab.", 503);
  const uri = template.replaceAll("<db_username>", encodeURIComponent(process.env.MONGODB_USERNAME ?? ""))
    .replaceAll("<db_password>", encodeURIComponent(process.env.MONGODB_PASSWORD ?? ""));
  if (/[<>]/.test(uri)) throw new MediaError("database_setup", "Complète la configuration MongoDB dans backend/.env.", 503);
  return uri;
}
export async function database() {
  try {
    connection ??= new MongoClient(mongoUri(), { serverSelectionTimeoutMS: 7_500 }).connect().catch(error => { connection = null; throw error; });
    return (await connection).db(process.env.MONGODB_DATABASE?.trim() || "homelab");
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError("database", "Le stockage MongoDB est indisponible. Vérifie la configuration et la connexion du serveur.", 503);
  }
}
