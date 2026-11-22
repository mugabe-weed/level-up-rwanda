import { RowDataPacket } from 'mysql2/promise';
import { withTransaction } from './pool.ts';

export async function runSeeds(): Promise<{ seededSections: string[] }> {
  const seededSections: string[] = [];

  await withTransaction(async (conn) => {
    // 1. Challenge Categories
    const challengeCategories = [
      [
        'rwanda-heritage-civics',
        'Rwanda Heritage & Civics',
        'Umuco n’Uburere Mboneragihugu',
        'Patrimoine et Civisme du Rwanda',
        'History, civic values, geography, and national development milestones.',
        'Amateka, indangagaciro z’uburere mboneragihugu, ubumenyi bw’isi n’iterambere.',
        'Histoire, valeurs civiques, géographie et étapes du développement.',
        1,
      ],
      [
        'digital-literacy-coding',
        'Digital Literacy & Coding',
        'Ubumenyi bw’Ikoranabuhanga',
        'Compétences Numériques & Code',
        'Practical computing, online safety, web engineering, and data logic.',
        'Ubumenyi ngiro mu ikoranabuhanga, umutekano kuri murandasi no gukora porogaramu.',
        'Informatique pratique, sécurité en ligne, programmation et données.',
        2,
      ],
      [
        'mathematics-logic',
        'Mathematics & Logic',
        'Imibare n’Imitekerereze',
        'Mathématiques et Logique',
        'Everyday problem solving, quantitative reasoning, and analytical puzzles.',
        'Gukemura ibibazo ukoresheje imibare n’imitekerereze isobanutse.',
        'Résolution de problèmes, raisonnement quantitatif et logique.',
        3,
      ],
      [
        'entrepreneurship-finance',
        'Entrepreneurship & Finance',
        'Kwihangira Imirimo n’Imari',
        'Entrepreneuriat et Finance',
        'Budgeting, small business growth, savings, and cooperative management.',
        'Gucunga umutungo, gutangira umushinga muto no kwizigamira.',
        'Gestion financière, création d’entreprise et épargne.',
        4,
      ],
      [
        'communication-languages',
        'Communication & Languages',
        'Itumanaho n’Indimi',
        'Communication et Langues',
        'Clear writing, Kinyarwanda proficiency, English & French workplace skills.',
        'Kwandika neza, Ikinyarwanda cyiza n’indimi z’amahanga mu kazi.',
        'Rédaction claire, maîtrise du kinyarwanda et communication professionnelle.',
        5,
      ],
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
        cat,
      );
    }
    seededSections.push('challenge_categories');

    // 2. Course Categories
    const courseCategories = [
      [
        'digital-skills',
        'Digital Skills',
        'Ubumenyi bw’Ikoranabuhanga',
        'Compétences Numériques',
        'Core digital tools, internet safety, spreadsheets, and software development.',
        'Ibikoresho by’ikoranabuhanga, umutekano kuri murandasi n’imibare ku mashini.',
        'Outils numériques, cybersécurité, tableurs et développement logiciel.',
        1,
      ],
      [
        'career-readiness',
        'Career Readiness',
        'Kwitegura Umwuga',
        'Préparation Professionnelle',
        'CV writing, interviews, professional communication, and remote work.',
        'Kwandika umwirondoro (CV), ikiganiro cy’akazi n’itumanaho mu kazi.',
        'Rédaction de CV, entretiens et travail à distance.',
        2,
      ],
      [
        'entrepreneurship',
        'Entrepreneurship',
        'Kwihangira Imirimo',
        'Entrepreneuriat',
        'Turning local ideas into sustainable ventures across Rwanda.',
        'Guhindura igitekerezo umushinga urambye mu Rwanda.',
        'Transformer une idée locale en entreprise durable au Rwanda.',
        3,
      ],
      [
        'creative-media',
        'Creative Media & Design',
        'Ubuhanzi n’Itangazamakuru',
        'Médias Créatifs et Design',
        'Storytelling, visual design, photography, and digital publishing.',
        'Kubara inkuru, gushushanya, gufata amafoto no gutangaza ibihangano.',
        'Narration, design visuel, photographie et publication numérique.',
        4,
      ],
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
        cat,
      );
    }
    seededSections.push('course_categories');

    // 3. Opportunity Categories
    const oppCategories = [
      ['scholarships', 'Scholarships & Fellowships', 'Buruse n’Amahugurwa', 'Bourses d’Études', 1],
      ['internships', 'Internships & Apprenticeships', 'Kwimenyereza Umwuga', 'Stages Professionnels', 2],
      ['jobs-remote', 'Jobs & Remote Careers', 'Akazi n’Akazi ko Kure', 'Emplois et Télétravail', 3],
      ['grants-impact', 'Grants & Youth Innovation', 'Inkunga z’Imishinga', 'Subventions et Projets', 4],
      ['volunteering', 'Volunteering & Community', 'Ubushake n’Umuganda', 'Bénévolat', 5],
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
        cat,
      );
    }
    seededSections.push('opportunity_categories');

    // 4. Achievement Definitions
    const achievements = [
      [
        'first-challenge',
        'First Challenge Complete',
        'Igikorwa cya Mbere Cyagenze Neza',
        'Premier Défi Réussi',
        'Completed your first knowledge challenge on LEVELUP RWANDA.',
        'Warangije igikorwa cyawe cya mbere cy’ubumenyi kuri LEVELUP RWANDA.',
        'Vous avez terminé votre premier défi sur LEVELUP RWANDA.',
        'Trophy',
        'bronze',
        25,
        'challenges_completed',
        1,
      ],
      [
        'streak-3',
        '3-Day Consistency',
        'Iminsi 3 Ikuranira',
        'Série de 3 Jours',
        'Completed challenges on 3 consecutive days.',
        'Wakoze ibikorwa iminsi 3 ikurikirana.',
        'Défis terminés pendant 3 jours consécutifs.',
        'Flame',
        'silver',
        50,
        'streak_days',
        3,
      ],
      [
        'knowledge-seeker',
        'Course Finisher',
        'Uwarangije Isomo',
        'Cours Terminé',
        'Completed your first full learning course and assessments.',
        'Warangije isomo ryawe rya mbere n’isuzuma ryaryo.',
        'Vous avez terminé votre premier cours complet.',
        'GraduationCap',
        'gold',
        75,
        'courses_completed',
        1,
      ],
      [
        'creative-spark',
        'Creative Contributor',
        'Umuhanga mu Guhanga',
        'Créateur Actif',
        'Shared your first original project or story in Create.',
        'Watangaje igihangano cyawe cya mbere mu gice cyo Guhanga.',
        'Vous avez partagé votre première création.',
        'Palette',
        'bronze',
        25,
        'posts_created',
        1,
      ],
      [
        'xp-milestone-500',
        '500 XP Milestone',
        'Amanota 500 y’Uburambe',
        'Cap des 500 XP',
        'Earned 500 experience points through learning and challenges.',
        'Wagejeje amanota 500 y’uburambe binyuze mu kwiga no gukina.',
        'Vous avez accumulé 500 points d’expérience.',
        'Award',
        'gold',
        100,
        'total_xp',
        500,
      ],
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
        ach,
      );
    }
    seededSections.push('achievements');

    // 5. Default Platform Settings
    const settings: Array<[string, string, string]> = [
      ['maintenance_mode', JSON.stringify({ enabled: false }), 'Temporarily pause public writes'],
      ['registration_open', JSON.stringify({ enabled: true }), 'Allow new member sign-ups'],
      ['daily_challenge_xp_cap', JSON.stringify({ maxXpPerDay: 500 }), 'Daily XP limit from challenges'],
      ['youth_safety_mode', JSON.stringify({ strictModerationForUnder18: true }), 'Protect youth 13-17 accounts'],
      ['enabled_languages', JSON.stringify({ languages: ['rw', 'en', 'fr'] }), 'Enabled UI languages'],
    ];

    for (const [key, val, desc] of settings) {
      await conn.execute(
        `INSERT IGNORE INTO platform_settings (setting_key, setting_value_json, description)
         VALUES (?, CAST(? AS JSON), ?)`,
        [key, val, desc],
      );
    }
    seededSections.push('platform_settings');

    // 6. Clearly marked SAMPLE Challenges (only inserted if slug does not exist)
    const [catRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, slug FROM challenge_categories',
    );
    const chCatMap = new Map(catRows.map((r) => [String(r.slug), Number(r.id)]));

    const sampleChallenges = [
      {
        categorySlug: 'digital-literacy-coding',
        slug: 'sample-digital-safety-rwanda-daily',
        titleEn: '[Sample] Daily Challenge: Safe Digital Citizen in Rwanda',
        titleRw: '[Urugero] Irushanwa ry’Umunsi: Umutekano kuri Murandasi',
        titleFr: '[Exemple] Défi du Jour : Citoyen Numérique Sûr',
        descriptionEn:
          'Test practical habits for protecting mobile money accounts, personal passwords, and avoiding phishing links.',
        descriptionRw:
          'Gerageza ubumenyi bwo kurinda konti ya Mobile Money, ijambobanga n’uburiganya kuri murandasi.',
        descriptionFr:
          'Testez vos réflexes pour protéger vos comptes mobiles et mots de passe.',
        difficulty: 'beginner',
        challengeType: 'daily',
        timeLimitSeconds: 180,
        xpReward: 60,
        isFeatured: 1,
        questions: [
          {
            promptEn: 'You receive an SMS asking for your Mobile Money PIN to claim a prize. What should you do?',
            promptRw: 'Ubonye ubutumwa bugusaba PIN ya Mobile Money ngo uhabwe igihembo. Wakora iki?',
            promptFr: 'Un SMS vous demande votre code PIN Mobile Money pour recevoir un prix. Que faire ?',
            options: [
              'Reply immediately with your PIN',
              'Ignore, never share your PIN, and report the number',
              'Forward the SMS to friends',
              'Call the number and read your ID number',
            ],
            correctIndex: 1,
            explanationEn: 'No legitimate service or bank ever asks for your PIN via SMS or phone call.',
            explanationRw: 'Nta kigo cyemewe kigusaba PIN yawe kuri SMS cyangwa telefoni.',
            explanationFr: 'Aucun service légitime ne demande jamais votre code PIN.',
            weight: 20,
          },
          {
            promptEn: 'Which password is strongest for protecting your learning and career accounts?',
            promptRw: 'Ni irihe jambobanga rikomeye ririnda konti zawe zo kwiga n’akazi?',
            promptFr: 'Quel mot de passe protège le mieux vos comptes ?',
            options: [
              'kigali2026',
              '12345678',
              'Umisozi@Kigali!94#',
              'password1',
            ],
            correctIndex: 2,
            explanationEn: 'A strong password combines length (12+ chars), uppercase, lowercase, numbers, and symbols.',
            explanationRw: 'Ijambobanga rikomeye rigira inyuguti nkuru n’intoya, imibare n’ibimenyetso.',
            explanationFr: 'Un mot de passe robuste combine longueur, majuscules, chiffres et symboles.',
            weight: 20,
          },
          {
            promptEn: 'Before clicking a scholarship link shared in a group chat, what is the safest check?',
            promptRw: 'Mbere yo gukanda link ya buruse yoherejwe mu itsinda, ni iki ugomba kubanza kugenzura?',
            promptFr: 'Avant de cliquer sur un lien de bourse partagé en groupe, que vérifier ?',
            options: [
              'Verify the official domain name and HTTPS lock icon',
              'Click quickly before it expires',
              'Download any .exe file attached',
              'Share your national ID photo first',
            ],
            correctIndex: 0,
            explanationEn: 'Always check the official organization domain and HTTPS certificate before entering personal details.',
            explanationRw: 'Banza ugenzure izina ry’urubuga rwemewe (domain) n’ikimenyetso cya HTTPS.',
            explanationFr: 'Vérifiez toujours le nom de domaine officiel et le cadenas HTTPS.',
            weight: 20,
          },
        ],
      },
      {
        categorySlug: 'rwanda-heritage-civics',
        slug: 'sample-rwanda-geography-innovation',
        titleEn: '[Sample] Rwanda Geography & Innovation Sprint',
        titleRw: '[Urugero] Ubumenyi bw’Isi n’Udushya mu Rwanda',
        titleFr: '[Exemple] Géographie et Innovation au Rwanda',
        descriptionEn:
          'Explore Rwanda’s provinces, natural landmarks, and technology ecosystem milestones.',
        descriptionRw:
          'Menya intara z’u Rwanda, ibyiza nyaburanga n’iterambere mu ikoranabuhanga.',
        descriptionFr:
          'Découvrez les provinces du Rwanda, ses sites naturels et son essor technologique.',
        difficulty: 'beginner',
        challengeType: 'weekly',
        timeLimitSeconds: 240,
        xpReward: 75,
        isFeatured: 0,
        questions: [
          {
            promptEn: 'How many administrative provinces make up Rwanda (including the City of Kigali)?',
            promptRw: 'U Rwanda rugizwe n’intara zingahe (habariwemo n’Umujyi wa Kigali)?',
            promptFr: 'Combien d’entités provinciales composent le Rwanda (avec Kigali) ?',
            options: ['3', '4', '5', '6'],
            correctIndex: 2,
            explanationEn: 'Rwanda consists of Northern, Southern, Eastern, Western Provinces and the City of Kigali (5 total).',
            explanationRw: 'U Rwanda rugizwe n’Intara 4 n’Umujyi wa Kigali (zose hamwe ni 5).',
            explanationFr: 'Le Rwanda compte 4 provinces plus la ville de Kigali (5 au total).',
            weight: 25,
          },
          {
            promptEn: 'Which national service portal connects citizens in Rwanda to public services online?',
            promptRw: 'Ni uruhe rubuga rufasha Abanyarwanda kubona serivisi za Leta kuri murandasi?',
            promptFr: 'Quel portail national offre les services publics en ligne au Rwanda ?',
            options: ['Irembo', 'KigaliMail', 'RwandaPay', 'UmugandaNet'],
            correctIndex: 0,
            explanationEn: 'IremboGov provides digital access to civil registration, permits, and citizen services across Rwanda.',
            explanationRw: 'Irembo rifasha abaturage kubona serivisi za Leta mu buryo bw’ikoranabuhanga.',
            explanationFr: 'IremboGov centralise l’accès numérique aux services publics rwandais.',
            weight: 25,
          },
        ],
      },
      {
        categorySlug: 'entrepreneurship-finance',
        slug: 'sample-small-business-budgeting',
        titleEn: '[Sample] Entrepreneurship & Cashflow Basics',
        titleRw: '[Urugero] Ibanze mu Gucunga Umushinga n’Imari',
        titleFr: '[Exemple] Bases de Gestion et Trésorerie',
        descriptionEn:
          'Practice profit margin, separating personal and business funds, and savings habits.',
        descriptionRw:
          'Imenyereze kubara inyungu, gutandukanya amafaranga y’umushinga n’ayawe bwite no kwizigamira.',
        descriptionFr:
          'Maîtrisez la marge, la séparation des comptes et l’épargne d’entreprise.',
        difficulty: 'intermediate',
        challengeType: 'practice',
        timeLimitSeconds: 200,
        xpReward: 70,
        isFeatured: 0,
        questions: [
          {
            promptEn: 'A craft business spends 12,000 RWF on materials and sells the product for 18,000 RWF. What is the gross profit?',
            promptRw: 'Umushinga ukoresha 12,000 RWF ku bikoresho ukagurisha igicuruzwa kuri 18,000 RWF. Inyungu y’ibanze ni angahe?',
            promptFr: 'Un atelier dépense 12 000 RWF et vend à 18 000 RWF. Quelle est la marge brute ?',
            options: ['4,000 RWF', '6,000 RWF', '12,000 RWF', '30,000 RWF'],
            correctIndex: 1,
            explanationEn: 'Gross profit equals Revenue (18,000 RWF) minus direct material cost (12,000 RWF) = 6,000 RWF.',
            explanationRw: 'Inyungu iboneka ufashe igiciro cyo kugurisha (18,000) ugakuramo ikiguzi (12,000) = 6,000 RWF.',
            explanationFr: '18 000 RWF - 12 000 RWF = 6 000 RWF de marge brute.',
            weight: 35,
          },
          {
            promptEn: 'Why should an entrepreneur keep separate records for business money and household money?',
            promptRw: 'Kuki ari ngombwa gutandukanya imibare y’amafaranga y’ubucuruzi n’ay’urugo?',
            promptFr: 'Pourquoi séparer la comptabilité personnelle et professionnelle ?',
            options: [
              'To measure true profit and avoid accidentally spending business capital',
              'Because banks forbid using cash',
              'To pay higher fees',
              'It is only useful for big factories',
            ],
            correctIndex: 0,
            explanationEn: 'Separating finances lets you see real profitability and protects working capital.',
            explanationRw: 'Bituma umenya niba ubucuruzi bwunguka kandi bikarinda igishoro cy’umushinga.',
            explanationFr: 'Cela permet de mesurer la rentabilité réelle et de préserver le capital.',
            weight: 35,
          },
        ],
      },
    ];

    for (const ch of sampleChallenges) {
      const catId = chCatMap.get(ch.categorySlug);
      if (!catId) continue;

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM challenges WHERE slug = ?',
        [ch.slug],
      );
      if (existing.length > 0) continue;

      const [res] = await conn.execute<any>(
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
          ch.isFeatured,
        ],
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
            i + 1,
          ],
        );
      }
    }
    seededSections.push('sample_challenges');

    // 7. Clearly marked SAMPLE Courses
    const [courseCatRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, slug FROM course_categories',
    );
    const courseCatMap = new Map(courseCatRows.map((r) => [String(r.slug), Number(r.id)]));

    const sampleCourses = [
      {
        categorySlug: 'digital-skills',
        slug: 'sample-practical-web-foundations',
        titleEn: '[Sample] Practical Web & Digital Foundations',
        titleRw: '[Urugero] Ibanze mu Gukora Imbuga za Murandasi',
        titleFr: '[Exemple] Fondamentaux du Web Pratique',
        summaryEn:
          'Learn how websites work, structure accessible HTML pages, and apply responsive layouts for low-bandwidth devices.',
        summaryRw:
          'Wige uko imbuga za murandasi zikora, uko zitegurwa neza ku bakoresha bose n’uko zigenda neza kuri telefoni.',
        summaryFr:
          'Comprenez le fonctionnement du web et créez des pages rapides et accessibles.',
        level: 'beginner',
        estimatedMinutes: 40,
        xpReward: 120,
        modules: [
          {
            titleEn: 'Module 1: How the Web Works',
            titleRw: 'Igice cya 1: Uko Murandasi Ikora',
            titleFr: 'Module 1 : Fonctionnement du Web',
            lessons: [
              {
                titleEn: 'Browsers, Servers, and Fast Loading',
                titleRw: 'Mushakisha, Seriveri n’Umuvuduko wo Gufunguka',
                titleFr: 'Navigateurs, Serveurs et Performance',
                contentEn:
                  'Every time you open a website on your phone in Kigali or upcountry, your browser sends a request to a server. Keeping images compressed and pages clean ensures learners with limited data bundles can study smoothly.',
                contentRw:
                  'Iyo ufunguye urubuga kuri telefoni yawe, mushakisha yohereza ubusabe kuri seriveri. Kugabanya uburemere bw’amafoto bituma urubuga rufunguka vuba kandi ntirutware amainternet menshi.',
                contentFr:
                  'Lorsque vous ouvrez un site, votre navigateur interroge un serveur. Des images légères garantissent un accès fluide même avec une connexion limitée.',
                durationMinutes: 10,
                xpReward: 30,
                assessment: {
                  question: 'Why should web images be compressed before uploading?',
                  options: [
                    'To reduce data usage and load pages faster on mobile networks',
                    'To make text impossible to read',
                    'To disable HTTPS security',
                  ],
                  correctIndex: 0,
                  explanation: 'Compressed images load significantly faster and save mobile data for users.',
                },
              },
              {
                titleEn: 'Accessible Headings and Clear Forms',
                titleRw: 'Imitwe y’Inyandiko n’Imbonerahamwe Zisobanutse',
                titleFr: 'Titres Accessibles et Formulaires Clairs',
                contentEn:
                  'Good digital products work for everyone, including older adults and screen reader users. Use clear labels above every input field, high color contrast, and plain everyday wording.',
                contentRw:
                  'Ikoranabuhanga ryiza rifasha buri wese. Koresha amagambo yoroshye kumva, amabara agaragara neza n’ubusobanuro buri hejuru ya buri kazu ko kwandikamo.',
                contentFr:
                  'Une interface accessible utilise des étiquettes claires, un bon contraste et un langage simple.',
                durationMinutes: 15,
                xpReward: 30,
                assessment: {
                  question: 'What helps screen-reader users and first-time users complete a form accurately?',
                  options: [
                    'Visible labels and clear error messages',
                    'Removing all labels',
                    'Using low-contrast gray text on gray backgrounds',
                  ],
                  correctIndex: 0,
                  explanation: 'Explicit labels and clear error messages make forms usable for everyone.',
                },
              },
            ],
          },
        ],
      },
      {
        categorySlug: 'career-readiness',
        slug: 'sample-career-cv-interview-rwanda',
        titleEn: '[Sample] Writing a Standout CV & Preparing for Interviews',
        titleRw: '[Urugero] Kwandika Umwirondoro (CV) no Kwitegura Ikiganiro cy’Akazi',
        titleFr: '[Exemple] Rédiger un CV Efficace et Réussir ses Entretiens',
        summaryEn:
          'Step-by-step guidance for students and job seekers in Rwanda to present achievements clearly to local and remote employers.',
        summaryRw:
          'Inama ngiro zifasha abanyeshuri n’abashaka akazi mu Rwanda kugaragaza ubushobozi bwabo neza.',
        summaryFr:
          'Guide pratique pour valoriser vos compétences auprès des recruteurs locaux et internationaux.',
        level: 'beginner',
        estimatedMinutes: 35,
        xpReward: 100,
        modules: [
          {
            titleEn: 'Module 1: Clear Impact on Your CV',
            titleRw: 'Igice cya 1: Kugaragaza Umusaruro wawe kuri CV',
            titleFr: 'Module 1 : Mettre en Valeur vos Résultats',
            lessons: [
              {
                titleEn: 'Action Verbs and Measurable Results',
                titleRw: 'Ibikorwa Bifatika n’Imibare Igaragara',
                titleFr: 'Verbes d’Action et Résultats Chiffrés',
                contentEn:
                  'Instead of writing "Responsible for social media", describe what you achieved: "Grew community workshop attendance by 40% over 3 months through weekly updates." Keep your CV to 1–2 crisp pages.',
                contentRw:
                  'Aho kwandika gusa ngo "Nakoraga itumanaho", garagaza ibyo wagezeho mu mibare: "Nazamuye ubwitabire bw’amahugurwa ku kigero cya 40% mu mezi 3."',
                contentFr:
                  'Privilégiez des réalisations concrètes et mesurables sur une à deux pages bien structurées.',
                durationMinutes: 15,
                xpReward: 40,
                assessment: {
                  question: 'Which CV bullet point is strongest?',
                  options: [
                    'Helped customers at shop',
                    'Organized inventory for 120 products and reduced stock errors by 25%',
                    'Worked hard every day',
                  ],
                  correctIndex: 1,
                  explanation: 'Specific actions paired with measurable outcomes help employers immediately understand your impact.',
                },
              },
            ],
          },
        ],
      },
    ];

    for (const course of sampleCourses) {
      const catId = courseCatMap.get(course.categorySlug);
      if (!catId) continue;

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM courses WHERE slug = ?',
        [course.slug],
      );
      if (existing.length > 0) continue;

      const [cRes] = await conn.execute<any>(
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
          course.xpReward,
        ],
      );
      const courseId = cRes.insertId;

      for (let mIdx = 0; mIdx < course.modules.length; mIdx++) {
        const mod = course.modules[mIdx];
        const [mRes] = await conn.execute<any>(
          `INSERT INTO course_modules (course_id, title_en, title_rw, title_fr, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
          [courseId, mod.titleEn, mod.titleRw, mod.titleFr, mIdx + 1],
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
              lIdx + 1,
            ],
          );
        }
      }
    }
    seededSections.push('sample_courses');

    // 8. Sample Community Groups
    const sampleGroups = [
      [
        'kigali-digital-builders',
        'Kigali Digital Builders [Sample]',
        'A friendly space for learners practicing coding, UI design, and digital problem-solving across Rwanda.',
        'Technology',
      ],
      [
        'rwanda-youth-entrepreneurs',
        'Rwanda Youth Entrepreneurs [Sample]',
        'Share small business ideas, market insights, and cooperative growth lessons.',
        'Entrepreneurship',
      ],
    ];

    for (const [slug, name, desc, category] of sampleGroups) {
      await conn.execute(
        `INSERT IGNORE INTO community_groups (slug, name, description, category, is_private, member_count, status, is_sample)
         VALUES (?, ?, ?, ?, 0, 0, 'active', 1)`,
        [slug, name, desc, category],
      );
    }
    seededSections.push('sample_community_groups');

    // 9. Sample Approved Opportunities
    const [oppCatRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, slug FROM opportunity_categories',
    );
    const oppCatMap = new Map(oppCatRows.map((r) => [String(r.slug), Number(r.id)]));

    const sampleOpportunities = [
      {
        catSlug: 'scholarships',
        type: 'scholarship',
        title: '[Sample] Rwanda Digital Talent Scholarship 2027',
        org: 'Kigali Innovation Academy',
        location: 'Kigali, Rwanda',
        isRemote: 0,
        summary:
          'Full tuition support for Rwandan youth pursuing software engineering, data analysis, and civic technology tracks.',
        eligibility: 'Rwandan residents aged 18–28 with secondary school completion.',
        url: 'https://www.minict.gov.rw',
        daysAhead: 60,
        featured: 1,
      },
      {
        catSlug: 'internships',
        type: 'internship',
        title: '[Sample] Junior Product & Web Support Internship',
        org: 'Norrsken East Africa Partner Hub',
        location: 'Kigali, Rwanda',
        isRemote: 0,
        summary:
          '6-month paid learning internship supporting community startups with documentation, QA testing, and web design.',
        eligibility: 'University students or recent graduates with foundational HTML/CSS knowledge.',
        url: 'https://www.norrsken.org',
        daysAhead: 45,
        featured: 1,
      },
      {
        catSlug: 'jobs-remote',
        type: 'remote_job',
        title: '[Sample] Remote Junior Data Operations Associate',
        org: 'East Africa Analytics Collective',
        location: 'Remote (East Africa)',
        isRemote: 1,
        summary:
          'Analyze survey datasets, maintain clean spreadsheets, and build weekly partner reports from anywhere in Rwanda.',
        eligibility: 'Strong spreadsheet skills, reliable internet access, and clear written English.',
        url: 'https://rdb.rw',
        daysAhead: 30,
        featured: 0,
      },
      {
        catSlug: 'grants-impact',
        type: 'grant',
        title: '[Sample] Community Green Innovation Micro-Grant',
        org: 'Rwanda Civic Makers Fund',
        location: 'All Districts, Rwanda',
        isRemote: 0,
        summary:
          'Seed grants for youth-led sustainability, agriculture tech, and clean water solutions in local sectors.',
        eligibility: 'Teams of 2–5 members based in Rwanda with a working prototype or community pilot.',
        url: 'https://rema.gov.rw',
        daysAhead: 75,
        featured: 0,
      },
    ];

    for (const opp of sampleOpportunities) {
      const catId = oppCatMap.get(opp.catSlug);
      if (!catId) continue;

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM opportunities WHERE title = ?',
        [opp.title],
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
          opp.featured,
        ],
      );
    }
    seededSections.push('sample_opportunities');
  });

  return { seededSections };
}
