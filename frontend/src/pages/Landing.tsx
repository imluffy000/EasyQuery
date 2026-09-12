/**
 * Public landing page.
 *
 * The one place in the product with a marketing voice. It still runs on the
 * Instrument tokens — square, border-led, warm neutral — but at a lower
 * density than the workspace, and it is the only surface permitted to use the
 * text-4xl/5xl display sizes.
 *
 * The hero shows the actual pipeline rather than an abstract illustration:
 * question -> plan -> SQL -> guard -> result. That sequence is the product,
 * and showing it is more persuasive than describing it.
 *
 * Motion follows the same idea. The example turn assembles in pipeline order
 * as the page loads, sections arrive as they are scrolled to, and the only
 * scroll-linked effects -- a receding hero, a rule that fills along the three
 * steps -- tie position on the page to progress through the story. Native
 * scrolling is never taken over, and phones and reduced motion get none of the
 * scroll-linked work.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  GitBranch,
  Lock,
  ScrollText,
  ShieldCheck,
  Table2,
} from 'lucide-react'

import {
  MagneticButton,
  ParallaxElement,
  Reveal,
  ScrollProgress,
  Stagger,
  StaggerItem,
} from '@/components/motion'
import { Badge, Button } from '@/components/ui'

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Read-only by construction',
    body: 'Every statement is parsed and validated before it runs. Writes, DDL, and multi-statement input are rejected at the guard, not by asking the model to behave.',
  },
  {
    icon: Eye,
    title: 'You see the SQL that ran',
    body: 'Generated and executed SQL are shown separately, so when the guard rewrites a statement — injecting a LIMIT, for instance — you see exactly what hit your database.',
  },
  {
    icon: GitBranch,
    title: 'Cost checked before execution',
    body: 'Queries are put through EXPLAIN first. Anything above the cost threshold stops and asks you before it touches a row.',
  },
  {
    icon: Table2,
    title: 'Schema-aware answers',
    body: 'Table and column metadata is synced and retrieved per question, so the model writes against your actual schema rather than guessing at names.',
  },
  {
    icon: BarChart3,
    title: 'Results you can read',
    body: 'Ten thousand rows render without stalling the browser. Charts are chosen from the result shape, and NULLs stay visible rather than being formatted away.',
  },
  {
    icon: ScrollText,
    title: 'Every query is audited',
    body: 'Who asked what, which SQL ran, how long it took and what it cost — recorded per workspace and queryable after the fact.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Connect a database',
    body: 'Point it at PostgreSQL or Supabase with a read-only role. Credentials are encrypted at rest; you choose which schemas are visible.',
  },
  {
    n: '02',
    title: 'Ask in plain language',
    body: 'The question is classified, planned, and turned into SQL against your synced schema. Ambiguous questions come back with a clarifying question instead of a guess.',
  },
  {
    n: '03',
    title: 'Read the answer and the SQL',
    body: 'You get the result, a written answer, and the exact statement that produced it — plus the query plan if you want to check its work.',
  },
]

export function LandingPage() {
  return (
    <div className="min-h-full bg-bg">
      <SiteHeader />

      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <Trust />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
        <Link to="/" className="flex items-center gap-2" aria-label="EasyQuery, home">
          <span className="h-3 w-3 shrink-0 bg-accent" aria-hidden />
          <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-fg">
            EasyQuery
          </span>
        </Link>


        <nav aria-label="Sections" className="ml-4 hidden gap-5 md:flex">
          {[
            ['How it works', '#how'],
            ['Features', '#features'],
            ['Security', '#security'],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="link-underline pb-0.5 text-2xs uppercase tracking-[0.1em] text-muted hover:text-fg"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex-1" />

        <Link to="/login">
          <Button size="sm" variant="ghost">
            Sign in
          </Button>
        </Link>
        <Link to="/register">
          <Button size="sm" variant="primary">
            Get started
          </Button>
        </Link>
      </div>
    </header>
  )
}

/** Arrow that leans toward where the button goes. Hover-capable, motion-safe only. */
const ARROW =
  'h-3.5 w-3.5 transition-transform duration-base motion-safe:group-hover:translate-x-0.5'

function Hero() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-20">
        {/* Promise, then proof, then the way in. */}
        <Stagger>
          <StaggerItem index={0} variant="fade">
            <Badge tone="accent">PostgreSQL &amp; Supabase</Badge>
          </StaggerItem>

          <StaggerItem
            as="h1"
            index={1}
            variant="clip"
            className="mt-4 text-balance text-4xl font-semibold text-fg lg:text-5xl"
          >
            Ask your database a question. Read the SQL it ran.
          </StaggerItem>

          <StaggerItem
            as="p"
            index={2}
            className="mt-4 max-w-xl text-base leading-relaxed text-muted"
          >
            Database Copilot turns plain-language questions into validated, read-only SQL — then
            shows you the statement, the query plan, and the cost before anything touches your
            data. Built for people who need the answer and the receipts.
          </StaggerItem>

          <StaggerItem index={3} className="mt-7 flex flex-wrap items-center gap-3">
            <MagneticButton>
              <Link to="/register">
                <Button size="md" variant="primary" className="group h-10 px-5">
                  Create an account <ArrowRight className={ARROW} aria-hidden />
                </Button>
              </Link>
            </MagneticButton>
            <Link to="/login">
              <Button size="md" variant="secondary" className="h-10 px-5">
                Sign in
              </Button>
            </Link>
          </StaggerItem>

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {['Read-only enforced', 'No data leaves your database', 'Full query audit'].map((t, i) => (
              <StaggerItem
                as="li"
                key={t}
                index={4 + i}
                variant="fade"
                className="flex items-center gap-1.5 text-xs text-muted"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                {t}
              </StaggerItem>
            ))}
          </ul>
        </Stagger>

        {/* Parallax sits on a wrapper; the reveal inside owns the figure's
            own transform, and two libraries must not write the same one. */}
        <ParallaxElement>
          <PipelineDemo />
        </ParallaxElement>
      </div>
    </section>
  )
}

/**
 * A still frame of a real turn. Values match the seeded demo database, so it
 * is an example rather than an invented screenshot.
 */
function PipelineDemo() {
  // Pieces arrive in the order the pipeline produces them: the question, the
  // SQL (wiped in, as if written), the rows, then the receipts. It starts once
  // the headline has landed, so the eye goes promise first, proof second.
  const at = (step: number) => step + 3
  return (
    <Stagger as="figure" className="panel overflow-hidden">
      <figcaption className="flex h-8 items-center gap-2 border-b border-border bg-elevated px-3">
        <span className="micro">Example turn</span>
      </figcaption>

      <div className="divide-y divide-border">
        <StaggerItem index={at(0)} variant="fade" className="px-3 py-2.5">
          <p className="micro mb-1">Question</p>
          <p className="text-sm text-fg">What are the top 5 products by total revenue?</p>
        </StaggerItem>

        <StaggerItem index={at(1)} variant="wipe" className="bg-sunken px-3 py-2.5">
          <div className="mb-1 flex items-center gap-2">
            <p className="micro">SQL executed</p>
            <Badge tone="info">rewritten by guard</Badge>
          </div>
          <pre className="overflow-x-auto font-mono text-2xs leading-relaxed text-fg">
            <code>{`SELECT p.name AS product_name,
       SUM(oi.line_total) AS revenue
  FROM products p
  JOIN order_items oi ON oi.product_id = p.id
 GROUP BY p.name
 ORDER BY revenue DESC
 LIMIT 5`}</code>
          </pre>
        </StaggerItem>

        <StaggerItem index={at(3)} variant="fade" className="px-3 py-2.5">
          <p className="micro mb-1.5">Result</p>
          <table className="w-full font-mono text-2xs tabular-nums">
            <thead>
              <tr className="text-left text-subtle">
                <th className="pb-1 font-medium">product_name</th>
                <th className="pb-1 text-right font-medium">revenue</th>
              </tr>
            </thead>
            <tbody className="text-fg">
              {[
                ['Product 160', '431280.00'],
                ['Product 60', '431280.00'],
                ['Product 96', '428400.00'],
              ].map(([name, rev]) => (
                <tr key={name} className="border-t border-border">
                  <td className="py-0.5">{name}</td>
                  <td className="py-0.5 text-right">{rev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StaggerItem>

        <StaggerItem
          index={at(4)}
          variant="fade"
          className="flex flex-wrap gap-x-4 gap-y-1 bg-elevated px-3 py-2"
        >
          <span className="readout">5 rows</span>
          <span className="readout">45 ms</span>
          <span className="readout">read-only</span>
          <span className="readout">cost checked</span>
        </StaggerItem>
      </div>
    </Stagger>
  )
}

/** Eyebrow and title arrive together as the section scrolls into view. */
function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <Reveal when="inView">
      <p className="micro">{eyebrow}</p>
      <h2 className="mt-2 text-balance text-3xl font-semibold text-fg">{title}</h2>
      {children}
    </Reveal>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="border-b border-border scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <SectionHeading eyebrow="How it works" title="Three steps from connection to answer" />

        {/* Numbered because these are genuinely sequential. The rule along
            the top fills as the section is scrolled through, so reading
            position and step order line up. */}
        <div className="relative mt-9">
          <ScrollProgress className="absolute inset-x-0 -top-px z-10 hidden h-0.5 md:block" />
          <Stagger
            as="ol"
            when="inView"
            className="grid gap-px border border-border bg-border md:grid-cols-3"
          >
            {STEPS.map((s, i) => (
              <StaggerItem as="li" key={s.n} index={i} className="bg-surface p-5">
                <span className="font-mono text-2xs font-semibold tracking-[0.1em] text-accent">
                  {s.n}
                </span>
                <h3 className="mt-2 text-base font-medium text-fg">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section id="features" className="border-b border-border scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <SectionHeading
          eyebrow="Features"
          title={<>Built so you never have to take the model&rsquo;s word for it</>}
        >
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            A language model writes the SQL. Everything that decides whether it runs is ordinary,
            auditable code.
          </p>
        </SectionHeading>

        {/* Not links, so no lift: a ground shift and a nudge of the icon
            acknowledge the pointer without promising a click. */}
        <Stagger
          when="inView"
          className="mt-9 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <StaggerItem
              as="article"
              key={title}
              index={i}
              className="group bg-surface p-5 transition-colors duration-base hover:bg-elevated"
            >
              <Icon
                className="h-4.5 w-4.5 text-accent transition-transform duration-base motion-safe:group-hover:-translate-y-0.5"
                aria-hidden
              />
              <h3 className="mt-2.5 text-base font-medium text-fg">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

function Trust() {
  return (
    <section id="security" className="border-b border-border scroll-mt-14">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:items-start">
        <SectionHeading eyebrow="Security" title="The guard does not trust the model">
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Prompt injection is assumed, not hoped against. A generated statement is parsed into a
            syntax tree and checked against an allow-list before execution — so a model that is
            talked into writing <code className="font-mono text-fg">DROP TABLE</code> produces a
            rejected query, not an incident.
          </p>

          <Link to="/register" className="mt-6 inline-block">
            <Button variant="secondary" className="group">
              Start with a read-only role <ArrowRight className={ARROW} aria-hidden />
            </Button>
          </Link>
        </SectionHeading>

        <Stagger as="ul" when="inView" className="grid gap-px border border-border bg-border">
          {[
            ['Statement allow-list', 'Only SELECT and WITH survive parsing. DDL, DML and multi-statement input are rejected.'],
            ['Schema confinement', 'Queries can only reach the schemas you marked visible on the connection.'],
            ['Row and time ceilings', 'A LIMIT is injected when absent, and a statement timeout is applied per connection.'],
            ['Credentials encrypted at rest', 'Database passwords are encrypted with a key held by the application, never logged.'],
            ['Per-workspace isolation', 'Connections, history and saved queries never cross a workspace boundary.'],
          ].map(([title, body], i) => (
            <StaggerItem as="li" key={title} index={i} className="flex gap-3 bg-surface p-4">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
              <div>
                <h3 className="text-sm font-medium text-fg">{title}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="border-b border-border bg-elevated">
      <Stagger when="inView" className="mx-auto max-w-6xl px-5 py-16 text-center">
        <StaggerItem as="h2" index={0} className="text-balance text-3xl font-semibold text-fg">
          Point it at a read-only role and ask it something
        </StaggerItem>
        <StaggerItem
          as="p"
          index={1}
          className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted"
        >
          Connect a database, ask a question, and check the SQL yourself. If the answer is wrong,
          you will be able to see exactly why.
        </StaggerItem>
        <StaggerItem index={2} className="mt-7 flex flex-wrap justify-center gap-3">
          <MagneticButton>
            <Link to="/register">
              <Button variant="primary" className="group h-10 px-5">
                Create an account <ArrowRight className={ARROW} aria-hidden />
              </Button>
            </Link>
          </MagneticButton>
          <Link to="/login">
            <Button variant="secondary" className="h-10 px-5">
              Sign in
            </Button>
          </Link>
        </StaggerItem>
      </Stagger>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 bg-accent" aria-hidden />
          <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-fg">
            Database Copilot
          </span>
        </div>
        <p className="text-2xs text-subtle">Natural-language analytics over your databases.</p>
        <div className="flex-1" />
        <nav aria-label="Footer" className="flex gap-5">
          <Link
            to="/login"
            className="link-underline pb-0.5 text-2xs uppercase tracking-[0.1em] text-muted hover:text-fg"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="link-underline pb-0.5 text-2xs uppercase tracking-[0.1em] text-muted hover:text-fg"
          >
            Get started
          </Link>
        </nav>
      </div>
    </footer>
  )
}
