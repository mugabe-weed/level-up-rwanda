// server/db/seed-cli.ts
import dotenv from "dotenv";

// server/db/pool.ts
import mysql from "mysql2/promise";

// server/db/config.ts
import fs from "fs";
var MysqlConfigurationError = class extends Error {
  constructor(message) {
    super(message);
    this.code = "MYSQL_CONFIG_ERROR";
    this.name = "MysqlConfigurationError";
  }
};
function getMysqlConfigStatus(env = process.env) {
  if (env.MYSQL_URL && env.MYSQL_URL.trim().length > 0) {
    return { configured: true, missingFields: [], mode: "url" };
  }
  const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
  const missingFields = required.filter((key) => !env[key] || env[key].trim().length === 0);
  if (missingFields.length === 0) {
    return { configured: true, missingFields: [], mode: "fields" };
  }
  return { configured: false, missingFields, mode: "unconfigured" };
}
function resolveMysqlCaCertificate(env = process.env) {
  if (env.MYSQL_CA_CERT !== void 0 && env.MYSQL_CA_CERT.trim().length > 0) {
    return env.MYSQL_CA_CERT.replace(/\\n/g, "\n");
  }
  if (env.MYSQL_CA_CERT_BASE64 !== void 0 && env.MYSQL_CA_CERT_BASE64.trim().length > 0) {
    const decoded = Buffer.from(env.MYSQL_CA_CERT_BASE64.trim(), "base64").toString("utf8").trim();
    if (!decoded) {
      throw new MysqlConfigurationError(
        "MYSQL_CA_CERT_BASE64 was provided but decoded to an empty certificate."
      );
    }
    return decoded;
  }
  if (env.MYSQL_CA_CERT_PATH !== void 0 && env.MYSQL_CA_CERT_PATH.trim().length > 0) {
    const certPath = env.MYSQL_CA_CERT_PATH.trim();
    if (!fs.existsSync(certPath)) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH points to a file that does not exist: ${certPath}`
      );
    }
    const stat = fs.statSync(certPath);
    if (!stat.isFile()) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH must point to a regular certificate file: ${certPath}`
      );
    }
    const content = fs.readFileSync(certPath, "utf8").trim();
    if (!content) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH certificate file is empty: ${certPath}`
      );
    }
    return content;
  }
  return void 0;
}
function parsePositiveInt(raw, fallback, min = 1) {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}
function buildMysqlPoolOptions(env = process.env) {
  const status = getMysqlConfigStatus(env);
  if (!status.configured) {
    return null;
  }
  const isProd = env.NODE_ENV === "production";
  const sslEnabled = env.MYSQL_SSL_ENABLED !== "false";
  const rejectUnauthorized = env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "false";
  if (isProd && (!sslEnabled || !rejectUnauthorized)) {
    throw new MysqlConfigurationError(
      "Strict MySQL TLS verification cannot be disabled in production (MYSQL_SSL_ENABLED and MYSQL_SSL_REJECT_UNAUTHORIZED must not be false)."
    );
  }
  if (sslEnabled && !rejectUnauthorized) {
    throw new MysqlConfigurationError(
      "MySQL TLS certificate verification cannot be silently disabled while MYSQL_SSL_ENABLED is true (MYSQL_SSL_REJECT_UNAUTHORIZED must remain true)."
    );
  }
  const ca = resolveMysqlCaCertificate(env);
  const sslOption = sslEnabled ? {
    ca,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2"
  } : void 0;
  const connectionLimit = parsePositiveInt(env.MYSQL_CONNECTION_LIMIT, 10, 1);
  const connectTimeout = parsePositiveInt(env.MYSQL_CONNECT_TIMEOUT_MS, 1e4, 1e3);
  if (status.mode === "url" && env.MYSQL_URL) {
    let url;
    try {
      url = new URL(env.MYSQL_URL);
    } catch {
      throw new MysqlConfigurationError(
        "MYSQL_URL is not a valid MySQL connection URI."
      );
    }
    const sslModeParam = (url.searchParams.get("ssl-mode") || url.searchParams.get("sslmode") || "").toLowerCase();
    const sslParam = (url.searchParams.get("ssl") || "").toLowerCase();
    if ((sslEnabled || isProd) && (sslModeParam === "disabled" || sslModeParam === "disable" || sslParam === "false")) {
      throw new MysqlConfigurationError(
        "MYSQL_URL attempts to disable SSL while strict TLS verification is active."
      );
    }
    return {
      host: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "") || env.MYSQL_DATABASE || "levelup_rwanda",
      ssl: sslOption,
      waitForConnections: true,
      connectionLimit,
      connectTimeout,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 1e4,
      timezone: "Z",
      multipleStatements: false
    };
  }
  return {
    host: env.MYSQL_HOST,
    port: parsePositiveInt(env.MYSQL_PORT, 3306, 1),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    ssl: sslOption,
    waitForConnections: true,
    connectionLimit,
    connectTimeout,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 1e4,
    timezone: "Z",
    multipleStatements: false
  };
}

// server/db/pool.ts
var DatabaseUnavailableError = class extends Error {
  constructor(missingFields) {
    super(
      `MySQL 8 database is not configured. Supply environment variables: ${missingFields.join(", ")}`
    );
    this.code = "DATABASE_NOT_CONFIGURED";
    this.statusCode = 503;
    this.name = "DatabaseUnavailableError";
    this.missingFields = missingFields;
  }
};
var poolInstance = null;
function getPool() {
  if (poolInstance) {
    return poolInstance;
  }
  const options = buildMysqlPoolOptions();
  if (!options) {
    const status = getMysqlConfigStatus();
    throw new DatabaseUnavailableError(status.missingFields);
  }
  poolInstance = mysql.createPool(options);
  return poolInstance;
}
async function withTransaction(fn) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
async function closePool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

// server/db/seed.ts
async function runSeeds() {
  const seededSections = [];
  await withTransaction(async (conn) => {
    const challengeCategories = [
      [
        "rwanda-heritage-civics",
        "Rwanda Heritage & Civics",
        "Umuco n\u2019Uburere Mboneragihugu",
        "Patrimoine et Civisme du Rwanda",
        "History, civic values, geography, and national development milestones.",
        "Amateka, indangagaciro z\u2019uburere mboneragihugu, ubumenyi bw\u2019isi n\u2019iterambere.",
        "Histoire, valeurs civiques, g\xE9ographie et \xE9tapes du d\xE9veloppement.",
        1
      ],
      [
        "digital-literacy-coding",
        "Digital Literacy & Coding",
        "Ubumenyi bw\u2019Ikoranabuhanga",
        "Comp\xE9tences Num\xE9riques & Code",
        "Practical computing, online safety, web engineering, and data logic.",
        "Ubumenyi ngiro mu ikoranabuhanga, umutekano kuri murandasi no gukora porogaramu.",
        "Informatique pratique, s\xE9curit\xE9 en ligne, programmation et donn\xE9es.",
        2
      ],
      [
        "mathematics-logic",
        "Mathematics & Logic",
        "Imibare n\u2019Imitekerereze",
        "Math\xE9matiques et Logique",
        "Everyday problem solving, quantitative reasoning, and analytical puzzles.",
        "Gukemura ibibazo ukoresheje imibare n\u2019imitekerereze isobanutse.",
        "R\xE9solution de probl\xE8mes, raisonnement quantitatif et logique.",
        3
      ],
      [
        "entrepreneurship-finance",
        "Entrepreneurship & Finance",
        "Kwihangira Imirimo n\u2019Imari",
        "Entrepreneuriat et Finance",
        "Budgeting, small business growth, savings, and cooperative management.",
        "Gucunga umutungo, gutangira umushinga muto no kwizigamira.",
        "Gestion financi\xE8re, cr\xE9ation d\u2019entreprise et \xE9pargne.",
        4
      ],
      [
        "communication-languages",
        "Communication & Languages",
        "Itumanaho n\u2019Indimi",
        "Communication et Langues",
        "Clear writing, Kinyarwanda proficiency, English & French workplace skills.",
        "Kwandika neza, Ikinyarwanda cyiza n\u2019indimi z\u2019amahanga mu kazi.",
        "R\xE9daction claire, ma\xEEtrise du kinyarwanda et communication professionnelle.",
        5
      ]
    ];
    for (const cat of challengeCategories) {
      await conn.execute(
        `INSERT INTO challenge_categories
          (slug, name_en, name_rw, name_fr, description_en, description_rw, description_fr, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          name_en = VALUES(name_en),
          name_rw = VALUES(name_rw),
          name_fr = VALUES(name_fr),
          description_en = VALUES(description_en),
          description_rw = VALUES(description_rw),
          description_fr = VALUES(description_fr),
          sort_order = VALUES(sort_order)`,
        cat
      );
    }
    seededSections.push("challenge_categories");
    const courseCategories = [
      [
        "digital-skills",
        "Digital Skills",
        "Ubumenyi bw\u2019Ikoranabuhanga",
        "Comp\xE9tences Num\xE9riques",
        "Core digital tools, internet safety, spreadsheets, and software development.",
        "Ibikoresho by\u2019ikoranabuhanga, umutekano kuri murandasi n\u2019imibare ku mashini.",
        "Outils num\xE9riques, cybers\xE9curit\xE9, tableurs et d\xE9veloppement logiciel.",
        1
      ],
      [
        "career-readiness",
        "Career Readiness",
        "Kwitegura Umwuga",
        "Pr\xE9paration Professionnelle",
        "CV writing, interviews, professional communication, and remote work.",
        "Kwandika umwirondoro (CV), ikiganiro cy\u2019akazi n\u2019itumanaho mu kazi.",
        "R\xE9daction de CV, entretiens et travail \xE0 distance.",
        2
      ],
      [
        "entrepreneurship",
        "Entrepreneurship",
        "Kwihangira Imirimo",
        "Entrepreneuriat",
        "Turning local ideas into sustainable ventures across Rwanda.",
        "Guhindura igitekerezo umushinga urambye mu Rwanda.",
        "Transformer une id\xE9e locale en entreprise durable au Rwanda.",
        3
      ],
      [
        "creative-media",
        "Creative Media & Design",
        "Ubuhanzi n\u2019Itangazamakuru",
        "M\xE9dias Cr\xE9atifs et Design",
        "Storytelling, visual design, photography, and digital publishing.",
        "Kubara inkuru, gushushanya, gufata amafoto no gutangaza ibihangano.",
        "Narration, design visuel, photographie et publication num\xE9rique.",
        4
      ]
    ];
    for (const cat of courseCategories) {
      await conn.execute(
        `INSERT INTO course_categories
          (slug, name_en, name_rw, name_fr, description_en, description_rw, description_fr, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          name_en = VALUES(name_en),
          name_rw = VALUES(name_rw),
          name_fr = VALUES(name_fr),
          sort_order = VALUES(sort_order)`,
        cat
      );
    }
    seededSections.push("course_categories");
    const oppCategories = [
      ["scholarships", "Scholarships & Fellowships", "Buruse n\u2019Amahugurwa", "Bourses d\u2019\xC9tudes", 1],
      ["internships", "Internships & Apprenticeships", "Kwimenyereza Umwuga", "Stages Professionnels", 2],
      ["jobs-remote", "Jobs & Remote Careers", "Akazi n\u2019Akazi ko Kure", "Emplois et T\xE9l\xE9travail", 3],
      ["grants-impact", "Grants & Youth Innovation", "Inkunga z\u2019Imishinga", "Subventions et Projets", 4],
      ["volunteering", "Volunteering & Community", "Ubushake n\u2019Umuganda", "B\xE9n\xE9volat", 5]
    ];
    for (const cat of oppCategories) {
      await conn.execute(
        `INSERT INTO opportunity_categories (slug, name_en, name_rw, name_fr, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          name_en = VALUES(name_en),
          name_rw = VALUES(name_rw),
          name_fr = VALUES(name_fr),
          sort_order = VALUES(sort_order)`,
        cat
      );
    }
    seededSections.push("opportunity_categories");
    const achievements = [
      [
        "first-challenge",
        "First Challenge Complete",
        "Igikorwa cya Mbere Cyagenze Neza",
        "Premier D\xE9fi R\xE9ussi",
        "Completed your first knowledge challenge on LEVELUP RWANDA.",
        "Warangije igikorwa cyawe cya mbere cy\u2019ubumenyi kuri LEVELUP RWANDA.",
        "Vous avez termin\xE9 votre premier d\xE9fi sur LEVELUP RWANDA.",
        "Trophy",
        "bronze",
        25,
        "challenges_completed",
        1
      ],
      [
        "streak-3",
        "3-Day Consistency",
        "Iminsi 3 Ikuranira",
        "S\xE9rie de 3 Jours",
        "Completed challenges on 3 consecutive days.",
        "Wakoze ibikorwa iminsi 3 ikurikirana.",
        "D\xE9fis termin\xE9s pendant 3 jours cons\xE9cutifs.",
        "Flame",
        "silver",
        50,
        "streak_days",
        3
      ],
      [
        "knowledge-seeker",
        "Course Finisher",
        "Uwarangije Isomo",
        "Cours Termin\xE9",
        "Completed your first full learning course and assessments.",
        "Warangije isomo ryawe rya mbere n\u2019isuzuma ryaryo.",
        "Vous avez termin\xE9 votre premier cours complet.",
        "GraduationCap",
        "gold",
        75,
        "courses_completed",
        1
      ],
      [
        "creative-spark",
        "Creative Contributor",
        "Umuhanga mu Guhanga",
        "Cr\xE9ateur Actif",
        "Shared your first original project or story in Create.",
        "Watangaje igihangano cyawe cya mbere mu gice cyo Guhanga.",
        "Vous avez partag\xE9 votre premi\xE8re cr\xE9ation.",
        "Palette",
        "bronze",
        25,
        "posts_created",
        1
      ],
      [
        "xp-milestone-500",
        "500 XP Milestone",
        "Amanota 500 y\u2019Uburambe",
        "Cap des 500 XP",
        "Earned 500 experience points through learning and challenges.",
        "Wagejeje amanota 500 y\u2019uburambe binyuze mu kwiga no gukina.",
        "Vous avez accumul\xE9 500 points d\u2019exp\xE9rience.",
        "Award",
        "gold",
        100,
        "total_xp",
        500
      ]
    ];
    for (const ach of achievements) {
      await conn.execute(
        `INSERT INTO achievements
          (slug, title_en, title_rw, title_fr, description_en, description_rw, description_fr, icon_name, badge_tier, xp_bonus, rule_type, rule_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          title_en = VALUES(title_en),
          title_rw = VALUES(title_rw),
          title_fr = VALUES(title_fr),
          xp_bonus = VALUES(xp_bonus)`,
        ach
      );
    }
    seededSections.push("achievements");
    const settings = [
      ["maintenance_mode", JSON.stringify({ enabled: false }), "Temporarily pause public writes"],
      ["registration_open", JSON.stringify({ enabled: true }), "Allow new member sign-ups"],
      ["daily_challenge_xp_cap", JSON.stringify({ maxXpPerDay: 500 }), "Daily XP limit from challenges"],
      ["youth_safety_mode", JSON.stringify({ strictModerationForUnder18: true }), "Protect youth 13-17 accounts"],
      ["enabled_languages", JSON.stringify({ languages: ["rw", "en", "fr"] }), "Enabled UI languages"]
    ];
    for (const [key, val, desc] of settings) {
      await conn.execute(
        `INSERT IGNORE INTO platform_settings (setting_key, setting_value_json, description)
         VALUES (?, CAST(? AS JSON), ?)`,
        [key, val, desc]
      );
    }
    seededSections.push("platform_settings");
    const [catRows] = await conn.execute(
      "SELECT id, slug FROM challenge_categories"
    );
    const chCatMap = new Map(catRows.map((r) => [String(r.slug), Number(r.id)]));
    const sampleChallenges = [
      {
        categorySlug: "digital-literacy-coding",
        slug: "sample-digital-safety-rwanda-daily",
        titleEn: "[Sample] Daily Challenge: Safe Digital Citizen in Rwanda",
        titleRw: "[Urugero] Irushanwa ry\u2019Umunsi: Umutekano kuri Murandasi",
        titleFr: "[Exemple] D\xE9fi du Jour : Citoyen Num\xE9rique S\xFBr",
        descriptionEn: "Test practical habits for protecting mobile money accounts, personal passwords, and avoiding phishing links.",
        descriptionRw: "Gerageza ubumenyi bwo kurinda konti ya Mobile Money, ijambobanga n\u2019uburiganya kuri murandasi.",
        descriptionFr: "Testez vos r\xE9flexes pour prot\xE9ger vos comptes mobiles et mots de passe.",
        difficulty: "beginner",
        challengeType: "daily",
        timeLimitSeconds: 180,
        xpReward: 60,
        isFeatured: 1,
        questions: [
          {
            promptEn: "You receive an SMS asking for your Mobile Money PIN to claim a prize. What should you do?",
            promptRw: "Ubonye ubutumwa bugusaba PIN ya Mobile Money ngo uhabwe igihembo. Wakora iki?",
            promptFr: "Un SMS vous demande votre code PIN Mobile Money pour recevoir un prix. Que faire ?",
            options: [
              "Reply immediately with your PIN",
              "Ignore, never share your PIN, and report the number",
              "Forward the SMS to friends",
              "Call the number and read your ID number"
            ],
            correctIndex: 1,
            explanationEn: "No legitimate service or bank ever asks for your PIN via SMS or phone call.",
            explanationRw: "Nta kigo cyemewe kigusaba PIN yawe kuri SMS cyangwa telefoni.",
            explanationFr: "Aucun service l\xE9gitime ne demande jamais votre code PIN.",
            weight: 20
          },
          {
            promptEn: "Which password is strongest for protecting your learning and career accounts?",
            promptRw: "Ni irihe jambobanga rikomeye ririnda konti zawe zo kwiga n\u2019akazi?",
            promptFr: "Quel mot de passe prot\xE8ge le mieux vos comptes ?",
            options: [
              "kigali2026",
              "12345678",
              "Umisozi@Kigali!94#",
              "password1"
            ],
            correctIndex: 2,
            explanationEn: "A strong password combines length (12+ chars), uppercase, lowercase, numbers, and symbols.",
            explanationRw: "Ijambobanga rikomeye rigira inyuguti nkuru n\u2019intoya, imibare n\u2019ibimenyetso.",
            explanationFr: "Un mot de passe robuste combine longueur, majuscules, chiffres et symboles.",
            weight: 20
          },
          {
            promptEn: "Before clicking a scholarship link shared in a group chat, what is the safest check?",
            promptRw: "Mbere yo gukanda link ya buruse yoherejwe mu itsinda, ni iki ugomba kubanza kugenzura?",
            promptFr: "Avant de cliquer sur un lien de bourse partag\xE9 en groupe, que v\xE9rifier ?",
            options: [
              "Verify the official domain name and HTTPS lock icon",
              "Click quickly before it expires",
              "Download any .exe file attached",
              "Share your national ID photo first"
            ],
            correctIndex: 0,
            explanationEn: "Always check the official organization domain and HTTPS certificate before entering personal details.",
            explanationRw: "Banza ugenzure izina ry\u2019urubuga rwemewe (domain) n\u2019ikimenyetso cya HTTPS.",
            explanationFr: "V\xE9rifiez toujours le nom de domaine officiel et le cadenas HTTPS.",
            weight: 20
          }
        ]
      },
      {
        categorySlug: "rwanda-heritage-civics",
        slug: "sample-rwanda-geography-innovation",
        titleEn: "[Sample] Rwanda Geography & Innovation Sprint",
        titleRw: "[Urugero] Ubumenyi bw\u2019Isi n\u2019Udushya mu Rwanda",
        titleFr: "[Exemple] G\xE9ographie et Innovation au Rwanda",
        descriptionEn: "Explore Rwanda\u2019s provinces, natural landmarks, and technology ecosystem milestones.",
        descriptionRw: "Menya intara z\u2019u Rwanda, ibyiza nyaburanga n\u2019iterambere mu ikoranabuhanga.",
        descriptionFr: "D\xE9couvrez les provinces du Rwanda, ses sites naturels et son essor technologique.",
        difficulty: "beginner",
        challengeType: "weekly",
        timeLimitSeconds: 240,
        xpReward: 75,
        isFeatured: 0,
        questions: [
          {
            promptEn: "How many administrative provinces make up Rwanda (including the City of Kigali)?",
            promptRw: "U Rwanda rugizwe n\u2019intara zingahe (habariwemo n\u2019Umujyi wa Kigali)?",
            promptFr: "Combien d\u2019entit\xE9s provinciales composent le Rwanda (avec Kigali) ?",
            options: ["3", "4", "5", "6"],
            correctIndex: 2,
            explanationEn: "Rwanda consists of Northern, Southern, Eastern, Western Provinces and the City of Kigali (5 total).",
            explanationRw: "U Rwanda rugizwe n\u2019Intara 4 n\u2019Umujyi wa Kigali (zose hamwe ni 5).",
            explanationFr: "Le Rwanda compte 4 provinces plus la ville de Kigali (5 au total).",
            weight: 25
          },
          {
            promptEn: "Which national service portal connects citizens in Rwanda to public services online?",
            promptRw: "Ni uruhe rubuga rufasha Abanyarwanda kubona serivisi za Leta kuri murandasi?",
            promptFr: "Quel portail national offre les services publics en ligne au Rwanda ?",
            options: ["Irembo", "KigaliMail", "RwandaPay", "UmugandaNet"],
            correctIndex: 0,
            explanationEn: "IremboGov provides digital access to civil registration, permits, and citizen services across Rwanda.",
            explanationRw: "Irembo rifasha abaturage kubona serivisi za Leta mu buryo bw\u2019ikoranabuhanga.",
            explanationFr: "IremboGov centralise l\u2019acc\xE8s num\xE9rique aux services publics rwandais.",
            weight: 25
          }
        ]
      },
      {
        categorySlug: "entrepreneurship-finance",
        slug: "sample-small-business-budgeting",
        titleEn: "[Sample] Entrepreneurship & Cashflow Basics",
        titleRw: "[Urugero] Ibanze mu Gucunga Umushinga n\u2019Imari",
        titleFr: "[Exemple] Bases de Gestion et Tr\xE9sorerie",
        descriptionEn: "Practice profit margin, separating personal and business funds, and savings habits.",
        descriptionRw: "Imenyereze kubara inyungu, gutandukanya amafaranga y\u2019umushinga n\u2019ayawe bwite no kwizigamira.",
        descriptionFr: "Ma\xEEtrisez la marge, la s\xE9paration des comptes et l\u2019\xE9pargne d\u2019entreprise.",
        difficulty: "intermediate",
        challengeType: "practice",
        timeLimitSeconds: 200,
        xpReward: 70,
        isFeatured: 0,
        questions: [
          {
            promptEn: "A craft business spends 12,000 RWF on materials and sells the product for 18,000 RWF. What is the gross profit?",
            promptRw: "Umushinga ukoresha 12,000 RWF ku bikoresho ukagurisha igicuruzwa kuri 18,000 RWF. Inyungu y\u2019ibanze ni angahe?",
            promptFr: "Un atelier d\xE9pense 12 000 RWF et vend \xE0 18 000 RWF. Quelle est la marge brute ?",
            options: ["4,000 RWF", "6,000 RWF", "12,000 RWF", "30,000 RWF"],
            correctIndex: 1,
            explanationEn: "Gross profit equals Revenue (18,000 RWF) minus direct material cost (12,000 RWF) = 6,000 RWF.",
            explanationRw: "Inyungu iboneka ufashe igiciro cyo kugurisha (18,000) ugakuramo ikiguzi (12,000) = 6,000 RWF.",
            explanationFr: "18 000 RWF - 12 000 RWF = 6 000 RWF de marge brute.",
            weight: 35
          },
          {
            promptEn: "Why should an entrepreneur keep separate records for business money and household money?",
            promptRw: "Kuki ari ngombwa gutandukanya imibare y\u2019amafaranga y\u2019ubucuruzi n\u2019ay\u2019urugo?",
            promptFr: "Pourquoi s\xE9parer la comptabilit\xE9 personnelle et professionnelle ?",
            options: [
              "To measure true profit and avoid accidentally spending business capital",
              "Because banks forbid using cash",
              "To pay higher fees",
              "It is only useful for big factories"
            ],
            correctIndex: 0,
            explanationEn: "Separating finances lets you see real profitability and protects working capital.",
            explanationRw: "Bituma umenya niba ubucuruzi bwunguka kandi bikarinda igishoro cy\u2019umushinga.",
            explanationFr: "Cela permet de mesurer la rentabilit\xE9 r\xE9elle et de pr\xE9server le capital.",
            weight: 35
          }
        ]
      }
    ];
    for (const ch of sampleChallenges) {
      const catId = chCatMap.get(ch.categorySlug);
      if (!catId) continue;
      const [existing] = await conn.execute(
        "SELECT id FROM challenges WHERE slug = ?",
        [ch.slug]
      );
      if (existing.length > 0) continue;
      const [res] = await conn.execute(
        `INSERT INTO challenges
          (category_id, slug, title_en, title_rw, title_fr, description_en, description_rw, description_fr, difficulty, challenge_type, time_limit_seconds, xp_reward, active_date, is_featured, status, is_sample)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, 'published', 1)`,
        [
          catId,
          ch.slug,
          ch.titleEn,
          ch.titleRw,
          ch.titleFr,
          ch.descriptionEn,
          ch.descriptionRw,
          ch.descriptionFr,
          ch.difficulty,
          ch.challengeType,
          ch.timeLimitSeconds,
          ch.xpReward,
          ch.isFeatured
        ]
      );
      const challengeId = res.insertId;
      for (let i = 0; i < ch.questions.length; i++) {
        const q = ch.questions[i];
        await conn.execute(
          `INSERT INTO challenge_questions
            (challenge_id, prompt_en, prompt_rw, prompt_fr, options_json, correct_option_index, explanation_en, explanation_rw, explanation_fr, points_weight, sort_order)
           VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?)`,
          [
            challengeId,
            q.promptEn,
            q.promptRw,
            q.promptFr,
            JSON.stringify(q.options),
            q.correctIndex,
            q.explanationEn,
            q.explanationRw,
            q.explanationFr,
            q.weight,
            i + 1
          ]
        );
      }
    }
    seededSections.push("sample_challenges");
    const [courseCatRows] = await conn.execute(
      "SELECT id, slug FROM course_categories"
    );
    const courseCatMap = new Map(courseCatRows.map((r) => [String(r.slug), Number(r.id)]));
    const sampleCourses = [
      {
        categorySlug: "digital-skills",
        slug: "sample-practical-web-foundations",
        titleEn: "[Sample] Practical Web & Digital Foundations",
        titleRw: "[Urugero] Ibanze mu Gukora Imbuga za Murandasi",
        titleFr: "[Exemple] Fondamentaux du Web Pratique",
        summaryEn: "Learn how websites work, structure accessible HTML pages, and apply responsive layouts for low-bandwidth devices.",
        summaryRw: "Wige uko imbuga za murandasi zikora, uko zitegurwa neza ku bakoresha bose n\u2019uko zigenda neza kuri telefoni.",
        summaryFr: "Comprenez le fonctionnement du web et cr\xE9ez des pages rapides et accessibles.",
        level: "beginner",
        estimatedMinutes: 40,
        xpReward: 120,
        modules: [
          {
            titleEn: "Module 1: How the Web Works",
            titleRw: "Igice cya 1: Uko Murandasi Ikora",
            titleFr: "Module 1 : Fonctionnement du Web",
            lessons: [
              {
                titleEn: "Browsers, Servers, and Fast Loading",
                titleRw: "Mushakisha, Seriveri n\u2019Umuvuduko wo Gufunguka",
                titleFr: "Navigateurs, Serveurs et Performance",
                contentEn: "Every time you open a website on your phone in Kigali or upcountry, your browser sends a request to a server. Keeping images compressed and pages clean ensures learners with limited data bundles can study smoothly.",
                contentRw: "Iyo ufunguye urubuga kuri telefoni yawe, mushakisha yohereza ubusabe kuri seriveri. Kugabanya uburemere bw\u2019amafoto bituma urubuga rufunguka vuba kandi ntirutware amainternet menshi.",
                contentFr: "Lorsque vous ouvrez un site, votre navigateur interroge un serveur. Des images l\xE9g\xE8res garantissent un acc\xE8s fluide m\xEAme avec une connexion limit\xE9e.",
                durationMinutes: 10,
                xpReward: 30,
                assessment: {
                  question: "Why should web images be compressed before uploading?",
                  options: [
                    "To reduce data usage and load pages faster on mobile networks",
                    "To make text impossible to read",
                    "To disable HTTPS security"
                  ],
                  correctIndex: 0,
                  explanation: "Compressed images load significantly faster and save mobile data for users."
                }
              },
              {
                titleEn: "Accessible Headings and Clear Forms",
                titleRw: "Imitwe y\u2019Inyandiko n\u2019Imbonerahamwe Zisobanutse",
                titleFr: "Titres Accessibles et Formulaires Clairs",
                contentEn: "Good digital products work for everyone, including older adults and screen reader users. Use clear labels above every input field, high color contrast, and plain everyday wording.",
                contentRw: "Ikoranabuhanga ryiza rifasha buri wese. Koresha amagambo yoroshye kumva, amabara agaragara neza n\u2019ubusobanuro buri hejuru ya buri kazu ko kwandikamo.",
                contentFr: "Une interface accessible utilise des \xE9tiquettes claires, un bon contraste et un langage simple.",
                durationMinutes: 15,
                xpReward: 30,
                assessment: {
                  question: "What helps screen-reader users and first-time users complete a form accurately?",
                  options: [
                    "Visible labels and clear error messages",
                    "Removing all labels",
                    "Using low-contrast gray text on gray backgrounds"
                  ],
                  correctIndex: 0,
                  explanation: "Explicit labels and clear error messages make forms usable for everyone."
                }
              }
            ]
          }
        ]
      },
      {
        categorySlug: "career-readiness",
        slug: "sample-career-cv-interview-rwanda",
        titleEn: "[Sample] Writing a Standout CV & Preparing for Interviews",
        titleRw: "[Urugero] Kwandika Umwirondoro (CV) no Kwitegura Ikiganiro cy\u2019Akazi",
        titleFr: "[Exemple] R\xE9diger un CV Efficace et R\xE9ussir ses Entretiens",
        summaryEn: "Step-by-step guidance for students and job seekers in Rwanda to present achievements clearly to local and remote employers.",
        summaryRw: "Inama ngiro zifasha abanyeshuri n\u2019abashaka akazi mu Rwanda kugaragaza ubushobozi bwabo neza.",
        summaryFr: "Guide pratique pour valoriser vos comp\xE9tences aupr\xE8s des recruteurs locaux et internationaux.",
        level: "beginner",
        estimatedMinutes: 35,
        xpReward: 100,
        modules: [
          {
            titleEn: "Module 1: Clear Impact on Your CV",
            titleRw: "Igice cya 1: Kugaragaza Umusaruro wawe kuri CV",
            titleFr: "Module 1 : Mettre en Valeur vos R\xE9sultats",
            lessons: [
              {
                titleEn: "Action Verbs and Measurable Results",
                titleRw: "Ibikorwa Bifatika n\u2019Imibare Igaragara",
                titleFr: "Verbes d\u2019Action et R\xE9sultats Chiffr\xE9s",
                contentEn: 'Instead of writing "Responsible for social media", describe what you achieved: "Grew community workshop attendance by 40% over 3 months through weekly updates." Keep your CV to 1\u20132 crisp pages.',
                contentRw: 'Aho kwandika gusa ngo "Nakoraga itumanaho", garagaza ibyo wagezeho mu mibare: "Nazamuye ubwitabire bw\u2019amahugurwa ku kigero cya 40% mu mezi 3."',
                contentFr: "Privil\xE9giez des r\xE9alisations concr\xE8tes et mesurables sur une \xE0 deux pages bien structur\xE9es.",
                durationMinutes: 15,
                xpReward: 40,
                assessment: {
                  question: "Which CV bullet point is strongest?",
                  options: [
                    "Helped customers at shop",
                    "Organized inventory for 120 products and reduced stock errors by 25%",
                    "Worked hard every day"
                  ],
                  correctIndex: 1,
                  explanation: "Specific actions paired with measurable outcomes help employers immediately understand your impact."
                }
              }
            ]
          }
        ]
      }
    ];
    for (const course of sampleCourses) {
      const catId = courseCatMap.get(course.categorySlug);
      if (!catId) continue;
      const [existing] = await conn.execute(
        "SELECT id FROM courses WHERE slug = ?",
        [course.slug]
      );
      if (existing.length > 0) continue;
      const [cRes] = await conn.execute(
        `INSERT INTO courses
          (category_id, slug, title_en, title_rw, title_fr, summary_en, summary_rw, summary_fr, level, estimated_minutes, xp_reward, status, is_sample)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1)`,
        [
          catId,
          course.slug,
          course.titleEn,
          course.titleRw,
          course.titleFr,
          course.summaryEn,
          course.summaryRw,
          course.summaryFr,
          course.level,
          course.estimatedMinutes,
          course.xpReward
        ]
      );
      const courseId = cRes.insertId;
      for (let mIdx = 0; mIdx < course.modules.length; mIdx++) {
        const mod = course.modules[mIdx];
        const [mRes] = await conn.execute(
          `INSERT INTO course_modules (course_id, title_en, title_rw, title_fr, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
          [courseId, mod.titleEn, mod.titleRw, mod.titleFr, mIdx + 1]
        );
        const moduleId = mRes.insertId;
        for (let lIdx = 0; lIdx < mod.lessons.length; lIdx++) {
          const lesson = mod.lessons[lIdx];
          await conn.execute(
            `INSERT INTO course_lessons
              (module_id, course_id, title_en, title_rw, title_fr, content_en, content_rw, content_fr, duration_minutes, xp_reward, assessment_question_json, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
            [
              moduleId,
              courseId,
              lesson.titleEn,
              lesson.titleRw,
              lesson.titleFr,
              lesson.contentEn,
              lesson.contentRw,
              lesson.contentFr,
              lesson.durationMinutes,
              lesson.xpReward,
              JSON.stringify(lesson.assessment),
              lIdx + 1
            ]
          );
        }
      }
    }
    seededSections.push("sample_courses");
    const sampleGroups = [
      [
        "kigali-digital-builders",
        "Kigali Digital Builders [Sample]",
        "A friendly space for learners practicing coding, UI design, and digital problem-solving across Rwanda.",
        "Technology"
      ],
      [
        "rwanda-youth-entrepreneurs",
        "Rwanda Youth Entrepreneurs [Sample]",
        "Share small business ideas, market insights, and cooperative growth lessons.",
        "Entrepreneurship"
      ]
    ];
    for (const [slug, name, desc, category] of sampleGroups) {
      await conn.execute(
        `INSERT IGNORE INTO community_groups (slug, name, description, category, is_private, member_count, status, is_sample)
         VALUES (?, ?, ?, ?, 0, 0, 'active', 1)`,
        [slug, name, desc, category]
      );
    }
    seededSections.push("sample_community_groups");
    const [oppCatRows] = await conn.execute(
      "SELECT id, slug FROM opportunity_categories"
    );
    const oppCatMap = new Map(oppCatRows.map((r) => [String(r.slug), Number(r.id)]));
    const sampleOpportunities = [
      {
        catSlug: "scholarships",
        type: "scholarship",
        title: "[Sample] Rwanda Digital Talent Scholarship 2027",
        org: "Kigali Innovation Academy",
        location: "Kigali, Rwanda",
        isRemote: 0,
        summary: "Full tuition support for Rwandan youth pursuing software engineering, data analysis, and civic technology tracks.",
        eligibility: "Rwandan residents aged 18\u201328 with secondary school completion.",
        url: "https://www.minict.gov.rw",
        daysAhead: 60,
        featured: 1
      },
      {
        catSlug: "internships",
        type: "internship",
        title: "[Sample] Junior Product & Web Support Internship",
        org: "Norrsken East Africa Partner Hub",
        location: "Kigali, Rwanda",
        isRemote: 0,
        summary: "6-month paid learning internship supporting community startups with documentation, QA testing, and web design.",
        eligibility: "University students or recent graduates with foundational HTML/CSS knowledge.",
        url: "https://www.norrsken.org",
        daysAhead: 45,
        featured: 1
      },
      {
        catSlug: "jobs-remote",
        type: "remote_job",
        title: "[Sample] Remote Junior Data Operations Associate",
        org: "East Africa Analytics Collective",
        location: "Remote (East Africa)",
        isRemote: 1,
        summary: "Analyze survey datasets, maintain clean spreadsheets, and build weekly partner reports from anywhere in Rwanda.",
        eligibility: "Strong spreadsheet skills, reliable internet access, and clear written English.",
        url: "https://rdb.rw",
        daysAhead: 30,
        featured: 0
      },
      {
        catSlug: "grants-impact",
        type: "grant",
        title: "[Sample] Community Green Innovation Micro-Grant",
        org: "Rwanda Civic Makers Fund",
        location: "All Districts, Rwanda",
        isRemote: 0,
        summary: "Seed grants for youth-led sustainability, agriculture tech, and clean water solutions in local sectors.",
        eligibility: "Teams of 2\u20135 members based in Rwanda with a working prototype or community pilot.",
        url: "https://rema.gov.rw",
        daysAhead: 75,
        featured: 0
      }
    ];
    for (const opp of sampleOpportunities) {
      const catId = oppCatMap.get(opp.catSlug);
      if (!catId) continue;
      const [existing] = await conn.execute(
        "SELECT id FROM opportunities WHERE title = ?",
        [opp.title]
      );
      if (existing.length > 0) continue;
      await conn.execute(
        `INSERT INTO opportunities
          (category_id, opportunity_type, title, organization_name, location, is_remote, summary, eligibility, application_url, deadline_at, approval_status, verified_status, is_featured, is_sample)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'approved', 'verified', ?, 1)`,
        [
          catId,
          opp.type,
          opp.title,
          opp.org,
          opp.location,
          opp.isRemote,
          opp.summary,
          opp.eligibility,
          opp.url,
          opp.daysAhead,
          opp.featured
        ]
      );
    }
    seededSections.push("sample_opportunities");
  });
  return { seededSections };
}

// server/db/seed-cli.ts
dotenv.config();
async function main() {
  const result = await runSeeds();
  console.log("Seeded sections:", result.seededSections.join(", "));
}
main().catch((err) => {
  console.error("Seed failed:", err);
  process.exitCode = 1;
}).finally(async () => {
  await closePool();
});
