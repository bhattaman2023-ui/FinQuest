import 'dotenv/config';
import { pool } from './pool';

// ── Seed data ────────────────────────────────────────────────────
// Run after migrations: node --require ts-node/register src/db/seed.ts

const STOCKS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', sector: 'Energy', description: 'India\'s largest private sector company by revenue. Operates in petrochemicals, oil & gas, retail and telecom.' },
  { symbol: 'TCS',      name: 'Tata Consultancy Services Ltd', sector: 'IT', description: 'India\'s largest IT services company, part of the Tata Group.' },
  { symbol: 'INFY',     name: 'Infosys Ltd', sector: 'IT', description: 'Global IT services and consulting company headquartered in Bengaluru.' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', sector: 'Banking', description: 'India\'s largest private sector bank by assets.' },
  { symbol: 'ICICIBANK',name: 'ICICI Bank Ltd', sector: 'Banking', description: 'India\'s second largest private sector bank.' },
  { symbol: 'ITC',      name: 'ITC Ltd', sector: 'FMCG', description: 'Indian conglomerate with businesses in FMCG, hotels, packaging, agribusiness and IT.' },
  { symbol: 'SBIN',     name: 'State Bank of India', sector: 'Banking', description: 'India\'s largest public sector bank, with over 500 million customers.' },
  { symbol: 'LT',       name: 'Larsen & Toubro Ltd', sector: 'Infrastructure', description: 'Indian multinational conglomerate in engineering, construction, manufacturing and financial services.' },
];

// Synthetic price data starting from 2024-01-01
function generatePrices(symbol: string, startPrice: number, days = 365) {
  const prices = [];
  let current = startPrice;
  const start = new Date('2024-01-01');

  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // Skip weekends

    const dailyReturn = (Math.random() - 0.48) * 0.025; // Slight upward bias
    current = current * (1 + dailyReturn);
    const open = current;
    const variation = current * 0.015;
    const high = open + Math.random() * variation;
    const low  = open - Math.random() * variation;
    const close = low + Math.random() * (high - low);
    const volume = Math.floor(500000 + Math.random() * 2000000);

    prices.push({
      symbol,
      trade_date: date.toISOString().split('T')[0],
      open:  Math.round(open  * 100) / 100,
      high:  Math.round(high  * 100) / 100,
      low:   Math.round(Math.min(low, open, close) * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
      data_source: 'SYNTHETIC_SAMPLE',
    });
  }
  return prices;
}

const START_PRICES: Record<string, number> = {
  RELIANCE:  2500, TCS:    4000, INFY:   1800, HDFCBANK: 1700,
  ICICIBANK: 1000, ITC:     450, SBIN:    750, LT:       3600,
};

const COURSES = [
  { slug: 'money-basics', title: 'Money Basics', category: 'basics', description: 'Start here: understand why investing matters, how inflation erodes wealth, and how compounding creates it.', sort_order: 1 },
  { slug: 'equity-markets', title: 'Equity & Markets', category: 'equity', description: 'How stock markets work in India — NSE, BSE, mutual funds, SIP and ETFs explained clearly.', sort_order: 2 },
  { slug: 'fixed-income', title: 'Fixed Income & Debt', category: 'fixed-income', description: 'Bonds, government securities, and fixed deposits — the lower-risk side of investing.', sort_order: 3 },
  { slug: 'derivatives', title: 'Derivatives', category: 'derivatives', description: 'Futures and options: how they work and why they carry extra risk.', sort_order: 4 },
  { slug: 'government-savings', title: 'Government Savings', category: 'govt-savings', description: 'PPF, NSC, Sukanya Samriddhi Yojana — government-backed savings schemes for Indian investors.', sort_order: 5 },
  { slug: 'taxes', title: 'Taxes & Planning', category: 'taxes', description: 'Capital gains, STCG vs LTCG, and essential tax concepts for Indian investors.', sort_order: 6 },
];

const LESSONS_DATA = [
  // ── Money Basics ─────────────────────────────────────────────
  {
    course_slug: 'money-basics', slug: 'why-invest', title: 'Why Should You Invest?', read_time_min: 8, sort_order: 1,
    objectives: ['Understand the difference between saving and investing', 'Learn why keeping money in a savings account may not be enough', 'Identify your first investing goal'],
    body_md: `## The Problem With Just Saving

You earn ₹50,000 a month. After expenses, you save ₹10,000. You put it in a savings account earning 3.5% per year. That feels safe.

But here's what actually happens: if inflation runs at 6% per year (India's long-run average), your ₹10,000 today will buy goods worth only ₹9,434 in a year. You *lost* purchasing power even while your bank balance grew.

**Saving keeps your money. Investing grows it.**

## What Is Investing?

Investing means putting your money to work — buying assets that have the potential to generate returns over time. In India, you can invest in:

- **Equity** (shares of companies listed on NSE or BSE)
- **Debt instruments** (bonds, fixed deposits, government schemes)
- **Mutual funds** (pooled vehicles managed by professionals)
- **Real estate** (property)
- **Gold** (physical, Sovereign Gold Bonds, or Gold ETFs)

## The Goal Is Not to Get Rich Quick

FINQUEST is not about finding the next multi-bagger. It's about *understanding* money so your decisions — when you invest real money — come from knowledge, not guesswork.

> "Investing is the act of forgoing consumption today to have the ability to consume more at a later date." — Warren Buffett

## Your First Goal

Before you invest a rupee, write down one financial goal:
- Emergency fund of 6 months' expenses
- Down payment for a home in 5 years
- Retirement corpus

A goal gives your investment a time horizon — which determines how much risk you can take.

---

*This is a simulated environment. All prices here are educational demonstrations, not real market data.*`,
    key_terms: [
      { term: 'Inflation', def: 'The general rise in prices over time, which reduces the purchasing power of money.' },
      { term: 'Compounding', def: 'Earning returns on your returns. The longer your investment horizon, the more powerful it becomes.' },
      { term: 'Asset', def: 'Something that holds or generates value: stocks, bonds, property, gold.' },
    ],
    key_takeaways: ['Saving ≠ investing. Inflation erodes savings over time.', 'Investing puts your money to work in assets that can outpace inflation.', 'Start with a clear financial goal — it sets your time horizon and risk tolerance.'],
  },
  {
    course_slug: 'money-basics', slug: 'inflation', title: 'Understanding Inflation', read_time_min: 10, sort_order: 2,
    objectives: ['Define inflation and CPI', 'Understand how the RBI measures and manages inflation', 'Calculate the real return on an investment'],
    body_md: `## What Is Inflation?

Inflation is the rate at which the general level of prices for goods and services rises. When inflation rises, each rupee buys a smaller basket of goods.

**Example:** A ₹100 basket of groceries in 2014 costs roughly ₹160 in 2024 — that's 60% inflation over 10 years, or about 4.8% per year.

## How Is Inflation Measured in India?

India uses two main indices:

| Index | Full Name | Measures |
|-------|-----------|----------|
| **CPI** | Consumer Price Index | Retail prices paid by households |
| **WPI** | Wholesale Price Index | Prices at the producer/wholesale level |

The **RBI** (Reserve Bank of India) uses CPI as the primary benchmark. Its inflation target is **4% ± 2%** (mandated by the Government of India since 2016).

## Real Return = Nominal Return − Inflation

If your Fixed Deposit earns 7% but inflation is 5.5%, your **real return** is only **1.5%**. This is the actual increase in your purchasing power.

$$\\text{Real Return} \\approx \\text{Nominal Return} - \\text{Inflation Rate}$$

(The precise formula is: Real Return = [(1 + Nominal) ÷ (1 + Inflation)] − 1)

## Why This Matters for Investing

- Equity (stocks) has historically returned 12–15% per year in India over long periods, well ahead of inflation.
- A savings account at 3.5% delivers a *negative* real return when inflation is 5%.
- PPF (8.2% as of late 2024*) and certain bonds can provide positive real returns with low risk.

*⚠️ Interest rates change. See CONTENT_TO_VERIFY.md for the "as of" date.*`,
    key_terms: [
      { term: 'CPI', def: 'Consumer Price Index — measures changes in prices of a basket of goods & services bought by households.' },
      { term: 'Real Return', def: 'The return on an investment after adjusting for inflation.' },
      { term: 'RBI', def: 'Reserve Bank of India — India\'s central bank, responsible for monetary policy and inflation management.' },
    ],
    key_takeaways: ['Inflation in India has averaged 5–6% historically. Plan for it.', 'Real return = nominal return minus inflation. A 7% FD is not 7% if inflation is 5%.', 'Equity has historically outpaced inflation over long periods in India.'],
  },
  {
    course_slug: 'money-basics', slug: 'compounding', title: 'The Power of Compounding', read_time_min: 12, sort_order: 3,
    objectives: ['Understand compounding and how it works', 'Calculate compound growth using the rule of 72', 'Compare compounding frequencies'],
    body_md: `## "The Eighth Wonder of the World"

Compounding means earning *returns on your returns*. It's simple in concept but dramatic in effect.

**Example:** ₹1,00,000 invested at 12% per year:

| Year | Value |
|------|-------|
| 0    | ₹1,00,000 |
| 5    | ₹1,76,234 |
| 10   | ₹3,10,585 |
| 20   | ₹9,64,629 |
| 30   | ₹29,95,992 |

Same money. Same rate. Just time.

## The Rule of 72

Divide 72 by your annual return rate to estimate how long it takes to double your money.

- At **6%** → 72 ÷ 6 = **12 years** to double
- At **12%** → 72 ÷ 12 = **6 years** to double
- At **15%** → 72 ÷ 15 ≈ **4.8 years** to double

## SIP and Compounding

A Systematic Investment Plan (SIP) in a mutual fund invests a fixed amount every month. The returns earned each month then also earn returns — compounding in action.

If you invest ₹5,000/month in an index fund averaging 12% per year:
- After 10 years: ~₹11.6 lakhs (invested ₹6 lakhs)
- After 20 years: ~₹49.9 lakhs (invested ₹12 lakhs)
- After 30 years: ~₹1.76 crores (invested ₹18 lakhs)

The compounding curve accelerates dramatically in later years — which is why starting early matters more than the amount you start with.

## Key Insight: Time > Amount

Starting 5 years earlier with the same monthly SIP amount creates more wealth than investing a larger amount 5 years later. **Don't wait for the "right time". Start small, start now.**`,
    key_terms: [
      { term: 'Compounding', def: 'Earning returns on your previously earned returns, creating exponential growth over time.' },
      { term: 'SIP', def: 'Systematic Investment Plan — investing a fixed amount regularly (usually monthly) in mutual funds.' },
      { term: 'Rule of 72', def: 'A shortcut to estimate how many years it takes to double money: 72 ÷ annual return rate.' },
    ],
    key_takeaways: ['Compounding creates exponential, not linear, growth over time.', 'Time is the most important factor — starting early beats investing more later.', 'SIP in equity mutual funds benefits from both rupee-cost averaging and compounding.'],
  },
  {
    course_slug: 'money-basics', slug: 'financial-goals', title: 'Setting Financial Goals', read_time_min: 8, sort_order: 4,
    objectives: ['Classify goals as short, medium or long term', 'Understand SMART financial goals', 'Match goals to appropriate investment vehicles'],
    body_md: `## Why Goals Matter

Investing without a goal is like driving without a destination. Your time horizon (how long before you need the money) determines:
- **How much risk you can take** (more time = more room for volatility)
- **What to invest in** (equity for long-term, debt/cash for short-term)
- **How much to save** (working backward from the target)

## Classify Your Goals

### Short-Term (< 2 years)
- Emergency fund (6 months of expenses)
- Vacation fund, gadget purchase
- **Vehicle:** Liquid funds, high-interest savings, FD

### Medium-Term (2–7 years)
- Down payment for a house
- Higher education
- Starting a business
- **Vehicle:** Debt mutual funds, hybrid funds, balanced advantage funds

### Long-Term (> 7 years)
- Retirement corpus
- Child's education or marriage
- Financial independence
- **Vehicle:** Equity mutual funds, direct stocks, index funds

## Make Your Goals SMART

A SMART financial goal is:
- **S**pecific: "Save ₹20 lakhs" not "save more"
- **M**easurable: Track it monthly
- **A**chievable: Realistic given income and expenses
- **R**elevant: Aligned with your life plan
- **T**ime-bound: "In 5 years", not "someday"

**Example:** "Save ₹5,000/month in a balanced mutual fund for 5 years to build a ₹4 lakh down-payment corpus for a home."

## India-Specific Reminder

India has excellent government savings schemes (PPF, NSC, SSY) for specific long-term goals. We cover these in the Government Savings module.`,
    key_terms: [
      { term: 'Time Horizon', def: 'The period of time over which you plan to hold an investment before you need the money.' },
      { term: 'Liquidity', def: 'How quickly and easily you can convert an investment to cash without significant loss.' },
      { term: 'Asset Allocation', def: 'How you divide your investments among different asset classes (equity, debt, gold, etc.).' },
    ],
    key_takeaways: ['Classify every financial goal as short, medium or long-term.', 'Longer time horizon → more equity; shorter → more debt/liquid instruments.', 'SMART goals are specific, measurable, achievable, relevant and time-bound.'],
  },
  {
    course_slug: 'money-basics', slug: 'risk-and-return', title: 'Understanding Risk and Return', read_time_min: 10, sort_order: 5,
    objectives: ['Understand the risk-return tradeoff', 'Identify different types of investment risk', 'Learn how diversification reduces portfolio risk'],
    body_md: `## The Fundamental Tradeoff

**Higher potential return always comes with higher risk.** There is no high-return, no-risk investment — if someone promises you that, it's fraud.

This principle is called the **risk-return tradeoff**:

| Asset Class | Expected Return (India, long run) | Risk Level |
|-------------|----------------------------------|------------|
| Savings account | 3–4% | Very Low |
| Fixed Deposits | 6–7.5% | Low |
| Government bonds | 6.5–7.5% | Low |
| Debt mutual funds | 6–8% | Low–Medium |
| Balanced/hybrid funds | 8–11% | Medium |
| Index funds (Nifty 50) | 11–13% | Medium–High |
| Direct equity | Highly variable | High |
| Small-cap stocks | Highly variable | Very High |

*Past performance does not guarantee future returns.*

## Types of Risk

**Market risk** — the whole market goes down (2008, March 2020). No stock is immune.

**Company risk** — a specific company performs badly (management issues, sector disruption).

**Inflation risk** — your returns don't beat inflation. ₹100 today ≠ ₹100 in 10 years.

**Liquidity risk** — you can't sell when you need to (real estate, some bonds).

**Concentration risk** — too much of your portfolio in one stock, sector or asset.

## Diversification: Don't Put All Eggs in One Basket

Diversification means spreading investments across different assets, sectors and geographies. When one falls, another may hold or rise.

A well-diversified Indian portfolio might include:
- 60% equity (mix of large-cap, mid-cap, index funds)
- 30% debt (bonds, FD, debt funds)
- 10% alternatives (gold ETF, REITs)

**Key insight:** Diversification doesn't eliminate risk — it eliminates *unnecessary* risk (company-specific risk). Market-wide risk remains.`,
    key_terms: [
      { term: 'Risk-Return Tradeoff', def: 'The principle that higher potential returns are associated with higher risk. You cannot have both high returns and zero risk.' },
      { term: 'Diversification', def: 'Spreading investments across different assets, sectors or geographies to reduce overall portfolio risk.' },
      { term: 'Volatility', def: 'The degree to which an investment\'s price fluctuates over time. High volatility = higher risk.' },
    ],
    key_takeaways: ['Higher returns always come with higher risk. No exceptions.', 'Different types of risk affect investments differently — understand them.', 'Diversification reduces company-specific risk but not market-wide risk.'],
  },
  // ── Equity ──────────────────────────────────────────────────
  {
    course_slug: 'equity-markets', slug: 'intro-stocks', title: 'Introduction to Stock Markets', read_time_min: 15, sort_order: 1,
    objectives: ['Understand what a stock market is and its purpose', 'Learn how price discovery works', 'Identify the key participants in Indian stock markets'],
    body_md: `## What Is a Stock Market?

A stock market is an organised exchange where buyers and sellers trade ownership stakes in companies. When a company lists on the exchange, it offers shares to the public — this is called an **Initial Public Offering (IPO)**.

After the IPO, shares trade continuously between investors. The market price at any moment reflects what buyers are willing to pay and sellers are willing to accept.

## Why Companies List

Companies list on stock exchanges to raise capital. Instead of taking a bank loan (debt), they sell equity — giving investors a piece of ownership. The capital raised can fund expansion, pay debt, or fund research.

## India's Two Major Exchanges

**NSE** — National Stock Exchange, Mumbai. Largest by daily trading volume. Home of the Nifty 50 index.

**BSE** — Bombay Stock Exchange. Asia's oldest stock exchange (1875). Home of the Sensex (BSE 30).

Both are regulated by **SEBI** (Securities and Exchange Board of India). Every listed company must follow SEBI's disclosure and governance rules.

## How Price Discovery Works

When you place a buy order at ₹1,000 and a seller is willing to sell at ₹1,000, a trade happens. The market continuously runs this matching engine — called the **order book** — across millions of trades daily.

Prices rise when there are more buyers than sellers, and fall when there are more sellers than buyers.

## Key Market Participants

- **Retail investors** — individuals like you
- **FIIs/FPIs** — Foreign Institutional Investors (huge influence on Nifty)
- **DIIs** — Domestic Institutional Investors (mutual funds, insurance companies)
- **Brokers** — intermediaries who execute orders on exchanges
- **Market makers** — provide liquidity by quoting both buy and sell prices

---

**On FINQUEST's simulator**, you trade at simulated prices (clearly labelled). No real money, no real execution. The experience helps you understand *how* to trade before risking real capital.`,
    key_terms: [
      { term: 'IPO', def: 'Initial Public Offering — when a private company first sells shares to the public on a stock exchange.' },
      { term: 'SEBI', def: 'Securities and Exchange Board of India — the regulatory body for Indian securities markets.' },
      { term: 'Order Book', def: 'The electronic record of all outstanding buy and sell orders for a security at different prices.' },
      { term: 'Nifty 50', def: 'An index of the 50 largest companies by free-float market capitalisation listed on NSE.' },
      { term: 'Sensex', def: 'An index of the 30 largest companies listed on BSE. Full name: S&P BSE Sensex.' },
    ],
    key_takeaways: ['Stock markets allow companies to raise capital and investors to own a piece of businesses.', 'India has two major exchanges: NSE and BSE, both regulated by SEBI.', 'Prices are set by supply and demand, via continuous order-book matching.'],
  },
  {
    course_slug: 'equity-markets', slug: 'mutual-funds', title: 'Mutual Funds Explained', read_time_min: 12, sort_order: 4,
    objectives: ['Understand what a mutual fund is', 'Learn about different types of funds (equity, debt, hybrid)', 'Understand NAV, expense ratio, and direct vs regular plans'],
    body_md: `## What Is a Mutual Fund?

A mutual fund pools money from thousands of investors and invests in a diversified portfolio of securities (stocks, bonds, or both). A professional **fund manager** makes investment decisions on behalf of investors.

You don't buy shares of a company directly — you buy **units** of the mutual fund. The price of one unit is called the **NAV** (Net Asset Value).

$$\\text{NAV} = \\frac{\\text{Total Assets} - \\text{Total Liabilities}}{\\text{Number of Units Outstanding}}$$

## Types of Mutual Funds

### Equity Funds
Invest primarily in stocks. Higher risk, higher potential return over the long term.

- **Large-cap funds** — invest in top 100 companies by market cap (more stable)
- **Mid-cap funds** — companies ranked 101–250 (higher growth potential, more volatile)
- **Small-cap funds** — companies ranked 251+ (highest risk and potential)
- **Index funds** — passively track an index like Nifty 50 (low cost, no active management)

### Debt Funds
Invest in bonds, government securities, treasury bills. Lower risk, predictable returns.

### Hybrid Funds
Mix of equity and debt. The allocation varies by fund type (balanced, aggressive hybrid, etc.)

## Direct vs Regular Plans

| | Direct Plan | Regular Plan |
|-|-------------|--------------|
| Who buys | Direct from AMC | Through a broker/distributor |
| Expense ratio | Lower | Higher (includes distributor commission) |
| Returns | Higher | Lower |
| Best for | Self-directed investors | Those needing advice |

**Always check the expense ratio.** Even 0.5% difference compounds significantly over 20+ years.

## SEBI Categorisation (Important)

SEBI mandates that each fund house have only one fund per defined category, with clear investment mandates. This prevents duplication and misleading names.

Funds regulated by: **SEBI (Mutual Fund Regulations, 1996)** and overseen by **AMFI** (Association of Mutual Funds in India).`,
    key_terms: [
      { term: 'NAV', def: 'Net Asset Value — the price of one unit of a mutual fund. Calculated daily after market close.' },
      { term: 'Expense Ratio', def: 'The annual fee charged by a mutual fund to manage your money, expressed as a percentage of AUM.' },
      { term: 'SIP', def: 'Systematic Investment Plan — investing a fixed amount in a mutual fund at regular intervals (usually monthly).' },
      { term: 'AMC', def: 'Asset Management Company — the company that manages a mutual fund (e.g., SBI MF, HDFC AMC, Nippon India MF).' },
    ],
    key_takeaways: ['Mutual funds pool money and invest in a diversified portfolio managed by professionals.', 'NAV is the per-unit price of a mutual fund, calculated daily.', 'Direct plans have lower expense ratios than regular plans — prefer direct if you invest yourself.'],
  },
  // ── Fixed Income ────────────────────────────────────────────
  {
    course_slug: 'fixed-income', slug: 'bonds', title: 'Understanding Bonds', read_time_min: 12, sort_order: 1,
    objectives: ['Understand what a bond is and how it works', 'Learn key bond terms: coupon, maturity, yield, duration', 'Understand the inverse relationship between bond prices and yields'],
    body_md: `## What Is a Bond?

A bond is a **debt instrument** — when you buy a bond, you are lending money to the issuer (government or company). In return, the issuer promises to:
1. Pay you a fixed **coupon** (interest) periodically (usually semi-annually or annually)
2. Return the **face value** (principal) on the **maturity date**

**Example:** You buy a government bond with:
- Face value: ₹1,000
- Coupon rate: 7.5% per year
- Maturity: 10 years

You receive ₹75 per year (7.5% of ₹1,000) for 10 years, then ₹1,000 back at the end.

## Key Terms

| Term | Meaning |
|------|---------|
| **Coupon** | The fixed interest payment, as a % of face value |
| **Face value / Par value** | The amount repaid at maturity (usually ₹1,000 or ₹100) |
| **Maturity date** | When the principal is repaid |
| **Yield** | The return you earn if you hold to maturity (accounting for the price you paid) |
| **Duration** | Sensitivity to interest rate changes (higher = more sensitive) |
| **Credit rating** | Creditworthiness of the issuer (AAA = safest, D = defaulted) |

## The Price-Yield Relationship (Critical)

This is the most important concept in fixed income:

**When interest rates rise → bond prices fall.**
**When interest rates fall → bond prices rise.**

Why? If new bonds offer 8% and you hold an old bond at 7%, buyers will only pay less for your bond (driving its yield up to match the market). The price adjusts so the yield equals the market rate.

## Types of Bonds in India

- **Government Securities (G-Secs)** — issued by the central/state government. Zero default risk (backed by RBI). Can be bought on RBI Retail Direct.
- **Corporate bonds** — issued by companies. Higher yield, some default risk. Rated by CRISIL, ICRA, CARE.
- **Treasury Bills (T-bills)** — short-term (91, 182, 364 days). Issued at discount, redeemed at face value.
- **Sovereign Gold Bonds (SGBs)** — issued by RBI, backed by gold price. Earn 2.5% interest + gold appreciation.`,
    key_terms: [
      { term: 'Coupon', def: 'The fixed annual interest rate paid on a bond, expressed as a percentage of face value.' },
      { term: 'Yield to Maturity (YTM)', def: 'The total return expected on a bond if held until it matures, accounting for current price.' },
      { term: 'Duration', def: 'A measure of a bond\'s sensitivity to interest rate changes. Longer duration = more price sensitivity.' },
      { term: 'G-Sec', def: 'Government Security — a bond issued by the central or state government of India.' },
    ],
    key_takeaways: ['A bond is a loan — you are the lender, the issuer (govt or company) is the borrower.', 'Bond prices and yields move in opposite directions. This is the most important fixed-income rule.', 'Government bonds have zero default risk in India but are subject to market price risk.'],
  },
  // ── Derivatives ─────────────────────────────────────────────
  {
    course_slug: 'derivatives', slug: 'intro-derivatives', title: 'Introduction to Derivatives', read_time_min: 15, sort_order: 1,
    objectives: ['Understand what derivatives are and their purpose', 'Learn the basics of futures and options', 'Understand why derivatives are high-risk for beginners'],
    body_md: `## What Is a Derivative?

A derivative is a financial contract whose value *derives* from an underlying asset — such as a stock, index, commodity, or currency. You are not buying the asset itself; you are buying the right or obligation to transact in it at a future date and price.

**Key principle:** Derivatives are designed for hedging (reducing risk) but are often used for speculation (taking on risk). For beginners, they carry significant risk of losing more than you invest.

## Two Main Types in India

### Futures
A **futures contract** is a binding obligation to buy or sell an asset at a fixed price on a future date.

- **Example:** You buy a Nifty 50 futures contract expiring next month at 24,000. If Nifty closes at 25,000 on expiry, you profit ₹1,000 × lot size. If it closes at 23,000, you lose ₹1,000 × lot size.
- **Risk:** Losses are unlimited on the downside (for the buyer). Futures require margin.

### Options
An **options contract** gives you the *right but not the obligation* to buy (Call) or sell (Put) an asset at a predetermined price (the **strike price**) before or on a specific date (the **expiry**).

| Type | Right | Used when you expect |
|------|-------|---------------------|
| Call option | To buy at strike | Price to rise |
| Put option  | To sell at strike | Price to fall |

The **premium** is what you pay for the option. If you buy a Call option and the stock doesn't rise above the strike by expiry, the option expires worthless — you lose the premium.

## Why Derivatives Are High Risk

1. **Leverage:** A small move in the underlying causes a large gain or loss in the derivative.
2. **Time decay:** Options lose value as expiry approaches (Theta decay).
3. **Complexity:** Multiple variables affect options prices (volatility, time, interest rates).
4. **Margin calls:** Futures positions can require additional margin if the market moves against you.

**SEBI rule:** As of 2024–25, SEBI has restricted retail participation in index options with weekly expiry, citing evidence of consistent losses for retail traders.

> On FINQUEST, we do not simulate derivatives trading. This module is purely educational — to help you understand what these instruments are before you encounter them in real markets.`,
    key_terms: [
      { term: 'Derivative', def: 'A financial contract whose value is derived from an underlying asset (stock, index, commodity).' },
      { term: 'Futures', def: 'A binding contract to buy/sell an asset at a fixed price on a future date. Both parties are obligated.' },
      { term: 'Options', def: 'A contract giving the right (but not obligation) to buy (call) or sell (put) at a set price before expiry.' },
      { term: 'Premium', def: 'The price paid by the option buyer to the seller for the rights the option confers.' },
      { term: 'Leverage', def: 'Using a small amount of capital to control a much larger position. Amplifies both gains and losses.' },
    ],
    key_takeaways: ['Derivatives derive value from an underlying asset — you\'re not buying the asset itself.', 'Futures are obligations; options are rights. Both involve significant risk.', 'Never trade derivatives without fully understanding their mechanics. They can cause losses exceeding your initial investment.'],
  },
  // ── Government Savings ──────────────────────────────────────
  {
    course_slug: 'government-savings', slug: 'ppf', title: 'Public Provident Fund (PPF)', read_time_min: 10, sort_order: 1,
    objectives: ['Understand what PPF is and its key features', 'Learn about tax benefits under Section 80C', 'Calculate PPF maturity value and understand partial withdrawal rules'],
    body_md: `## What Is PPF?

The **Public Provident Fund (PPF)** is a long-term savings scheme backed by the Government of India. It is one of the safest investments available to Indian citizens — zero credit risk.

**Key features:**
- Tenure: **15 years** (extendable in blocks of 5 years)
- Current interest rate: **8.2% per annum** (compounded annually) — ⚠️ *rate reviewed quarterly by Ministry of Finance*
- Minimum deposit: ₹500 per year; Maximum: ₹1,50,000 per year
- Interest is **tax-free** (exempt from income tax)

## EEE Status: Triple Tax Benefit

PPF has **EEE** (Exempt-Exempt-Exempt) status:
1. **Exempt on investment:** Deduction under Section 80C (up to ₹1.5 lakh)
2. **Exempt on interest:** Interest earned is fully tax-free
3. **Exempt on maturity:** Maturity amount is fully tax-free

This makes PPF one of the best risk-free savings instruments in India.

## Calculating PPF Returns

If you invest ₹1,50,000 per year for 15 years at 8.2%:

- Total invested: ₹22,50,000
- Maturity value (approx.): ₹44.1 lakhs
- Tax-free returns: ₹21.6 lakhs

(Use the Quick Calculator on FINQUEST to try different scenarios.)

## Who Should Use PPF?

- Salaried individuals using Section 80C deduction
- Conservative investors seeking guaranteed, tax-free returns
- Long-term goal saving (retirement, children's education)

## Limitations

- **Lock-in:** 15 years (loans from year 3; partial withdrawal from year 7)
- **NRIs cannot open new PPF accounts** (existing ones can be held until maturity)
- **Interest rate risk:** Rate is reviewed quarterly and can change

⚠️ *The 8.2% rate shown is as of Q3 FY 2024–25. Check [NSSF website](https://www.nssfindia.com) for the current rate before investing.*`,
    key_terms: [
      { term: 'PPF', def: 'Public Provident Fund — a government-backed long-term savings scheme with EEE tax status and 15-year tenure.' },
      { term: 'Section 80C', def: 'The income tax provision that allows deduction of up to ₹1.5 lakh per year for specified investments (PPF, ELSS, LIC, etc.).' },
      { term: 'EEE', def: 'Exempt-Exempt-Exempt — a tax status where investment, interest and maturity amount are all tax-free.' },
    ],
    key_takeaways: ['PPF is government-backed, completely safe, and offers triple tax exemption (EEE).', 'Maximum ₹1.5 lakh/year investment; 15-year lock-in with limited partial withdrawal.', 'Interest rate changes quarterly — always check the current rate before investing.'],
  },
  // ── Taxes ────────────────────────────────────────────────────
  {
    course_slug: 'taxes', slug: 'capital-gains', title: 'Capital Gains Tax Basics', read_time_min: 10, sort_order: 1,
    objectives: ['Understand what capital gains are', 'Distinguish between short-term and long-term capital gains (STCG vs LTCG)', 'Know the applicable tax rates for Indian equity investors'],
    body_md: `## What Are Capital Gains?

When you sell an asset for more than what you paid for it, the profit is called a **capital gain**. When you sell for less, it's a **capital loss**.

Capital gains are **taxable in India** under the Income Tax Act, 1961.

## Two Types: STCG and LTCG

The tax rate depends on how long you held the asset — the **holding period**.

### For Equity (Shares, Equity MFs)

| Type | Holding Period | Tax Rate | Exemption |
|------|---------------|----------|-----------|
| **STCG** | Less than 12 months | **20%*** | None |
| **LTCG** | 12 months or more | **12.5%*** | ₹1.25 lakh per year* |

*⚠️ Rates and exemptions are as of Budget 2024–25 (effective July 23, 2024). These changed from the earlier 15%/10% rates and ₹1 lakh exemption. Always verify with the latest Finance Act.*

**Key change in Budget 2024:** STCG on equity was raised from 15% to 20%. LTCG exemption was raised from ₹1 lakh to ₹1.25 lakh.

### For Debt Instruments (Debt MFs, Bonds)

| Type | Holding Period | Tax Rate |
|------|---------------|----------|
| All capital gains | Any | Added to income, taxed at slab rate |

(Since April 1, 2023, the LTCG benefit on debt mutual funds was removed — they are now taxed at slab rate regardless of holding period.)

## Calculating Capital Gains

**Example (equity, long-term):**
- Bought 100 shares of TCS at ₹3,000 (Jan 2023) = ₹3,00,000
- Sold 100 shares at ₹4,200 (Feb 2024) = ₹4,20,000
- LTCG = ₹1,20,000
- Tax: ₹0 (within ₹1.25 lakh exemption)

**Example (equity, short-term):**
- Bought 50 shares of INFY at ₹1,800 (Oct 2024)
- Sold at ₹2,000 (Feb 2025)
- STCG = 50 × ₹200 = ₹10,000
- Tax = 20% × ₹10,000 = ₹2,000 + surcharge + cess

## Tax-Loss Harvesting

You can **set off capital losses against capital gains**:
- Short-term losses can be set off against STCG or LTCG
- Long-term losses can only be set off against LTCG

Carry-forward is allowed for 8 years.

⚠️ *Tax rules change with every Budget. This lesson reflects the law as of August 2024. Verify current rates at [incometax.gov.in](https://www.incometax.gov.in).*`,
    key_terms: [
      { term: 'Capital Gain', def: 'Profit earned from selling a capital asset at a price higher than the purchase price.' },
      { term: 'STCG', def: 'Short-Term Capital Gain — profit from selling equity held for less than 12 months. Taxed at 20% (Budget 2024–25).' },
      { term: 'LTCG', def: 'Long-Term Capital Gain — profit from selling equity held for 12+ months. Taxed at 12.5% above ₹1.25 lakh exemption (Budget 2024–25).' },
      { term: 'Tax-Loss Harvesting', def: 'Selling loss-making investments to offset capital gains and reduce tax liability.' },
    ],
    key_takeaways: ['Capital gains are profits from selling assets — taxable in India at different rates.', 'Equity held < 12 months = STCG (20%); 12+ months = LTCG (12.5%, ₹1.25L exempt).', 'Debt fund gains (post April 2023) are taxed at income slab rate regardless of holding period.'],
  },
];

const BADGES_SEED = [
  { code: 'FIRST_LESSON',   name: 'First Step',       description: 'Complete your first lesson.',          icon: '📖' },
  { code: 'FIRST_TRADE',    name: 'Market Debut',      description: 'Place your first virtual trade.',       icon: '📈' },
  { code: 'QUIZ_PASS',      name: 'Quiz Champ',        description: 'Pass a quiz on your first attempt.',    icon: '🏆' },
  { code: 'STREAK_7',       name: 'Week Warrior',      description: 'Maintain a 7-day learning streak.',     icon: '🔥' },
  { code: 'STREAK_30',      name: 'Monthly Master',    description: 'Maintain a 30-day learning streak.',    icon: '💎' },
  { code: 'COURSE_DONE',    name: 'Course Complete',   description: 'Finish all lessons in a course.',       icon: '🎓' },
  { code: 'DIVERSIFIED',    name: 'Diversified',       description: 'Hold 5+ different stocks in portfolio.', icon: '🌐' },
];

const CHALLENGES_SEED = [
  { code: 'LEARN_5',       title: 'Learning Streak',   description: 'Complete 5 lessons.',               xp_reward: 100, sort_order: 1 },
  { code: 'QUIZ_3',        title: 'Quiz Taker',         description: 'Pass 3 quizzes.',                   xp_reward: 75,  sort_order: 2 },
  { code: 'TRADE_5',       title: 'Active Trader',      description: 'Place 5 virtual trades.',           xp_reward: 50,  sort_order: 3 },
  { code: 'GLOSSARY_10',   title: 'Word Nerd',          description: 'Look up 10 glossary terms.',        xp_reward: 50,  sort_order: 4 },
  { code: 'FULL_COURSE',   title: 'Course Graduate',    description: 'Complete all lessons in a course.', xp_reward: 200, sort_order: 5 },
];

const GLOSSARY_SEED = [
  { term: 'Asset', category: 'basics', definition: 'Anything of economic value that can be owned or controlled — stocks, bonds, property, cash, gold.', example: 'A share of TCS listed on NSE is an asset.' },
  { term: 'Liability', category: 'basics', definition: 'A financial obligation or debt owed to others — a home loan, credit card balance, or personal loan.', example: 'A ₹30-lakh home loan is a liability.' },
  { term: 'Net Worth', category: 'basics', definition: 'Assets minus Liabilities. A snapshot of your financial health.', example: 'If you own assets worth ₹50L and owe ₹20L, your net worth is ₹30L.' },
  { term: 'Equity', category: 'equity', definition: 'Ownership in a company, represented by shares. Equity holders are the residual claimants on company profits.', example: 'Buying 10 shares of Infosys gives you a tiny equity stake in Infosys.' },
  { term: 'Share / Stock', category: 'equity', definition: 'A unit of ownership in a company. "Share" and "stock" are used interchangeably in India.', example: 'You own 50 shares of HDFC Bank.' },
  { term: 'Dividend', category: 'equity', definition: 'A portion of a company\'s profit distributed to shareholders, usually annually or quarterly.', example: 'ITC declared a dividend of ₹7.50 per share in FY24.' },
  { term: 'Market Capitalisation', category: 'equity', definition: 'The total market value of a company\'s outstanding shares. Price × Number of shares.', example: 'Reliance at ₹2,500/share × 1,352 crore shares = market cap ≈ ₹33.8 lakh crore.' },
  { term: 'P/E Ratio', category: 'equity', definition: 'Price-to-Earnings ratio. Market price per share divided by earnings per share. Indicates valuation relative to profits.', example: 'A P/E of 25 means investors pay ₹25 for every ₹1 of annual earnings.' },
  { term: 'Bull Market', category: 'equity', definition: 'A period of rising stock prices, typically defined as a 20%+ gain from recent lows. Investor sentiment is optimistic.', example: 'Nifty 50 rose from 7,500 to 18,500 between 2020 and 2022 — a strong bull run.' },
  { term: 'Bear Market', category: 'equity', definition: 'A period of falling stock prices, typically defined as a 20%+ decline from recent highs. Investor sentiment is pessimistic.', example: 'March 2020 saw a sharp bear market as COVID-19 fears hit global markets.' },
  { term: 'Mutual Fund', category: 'equity', definition: 'A pooled investment vehicle managed by a professional fund manager. Investors buy units; the fund invests in a portfolio of assets.', example: 'HDFC Nifty 50 Index Fund tracks the Nifty 50 index passively.' },
  { term: 'SIP', category: 'equity', definition: 'Systematic Investment Plan — investing a fixed amount in a mutual fund at regular intervals (usually monthly).', example: 'A ₹5,000/month SIP in an equity fund for 15 years at 12% grows to ~₹25 lakhs.' },
  { term: 'NAV', category: 'equity', definition: 'Net Asset Value — the per-unit price of a mutual fund, calculated after the market closes each day.', example: 'If a fund has total assets of ₹1,000 crore and 50 crore units, NAV = ₹20.' },
  { term: 'ETF', category: 'equity', definition: 'Exchange-Traded Fund — a fund that tracks an index and trades on a stock exchange like a share.', example: 'Nippon India ETF Nifty 50 BeES trades on NSE and mirrors the Nifty 50.' },
  { term: 'FD', category: 'fixed-income', definition: 'Fixed Deposit — a bank product where you deposit a lump sum for a fixed tenure at a fixed interest rate.', example: 'SBI 2-year FD currently offers ~6.8% per annum.' },
  { term: 'Bond', category: 'fixed-income', definition: 'A debt instrument where you lend money to the issuer (government or company) in exchange for periodic interest (coupon) and return of principal at maturity.', example: 'India 10-year Government Bond (G-Sec) is considered a risk-free benchmark.' },
  { term: 'Coupon', category: 'fixed-income', definition: 'The fixed interest payment on a bond, expressed as a percentage of its face value, paid periodically.', example: 'A bond with face value ₹1,000 and 7% coupon pays ₹70/year.' },
  { term: 'YTM', category: 'fixed-income', definition: 'Yield to Maturity — the total return expected on a bond if held to maturity, accounting for the current market price.', example: 'A bond bought at ₹950 (below ₹1,000 face value) has a higher YTM than its coupon rate.' },
  { term: 'PPF', category: 'savings', definition: 'Public Provident Fund — a 15-year government savings scheme offering tax-free returns with EEE status.', example: 'Maximum ₹1.5 lakh/year in PPF earns interest reviewed quarterly by the government.' },
  { term: 'LTCG', category: 'taxes', definition: 'Long-Term Capital Gains — profit from selling equity held for 12+ months. Taxed at 12.5% above ₹1.25 lakh exemption (Budget 2024–25).', example: 'Selling TCS shares held for 2 years at a profit of ₹2 lakhs: LTCG tax on ₹75,000 (above exemption).' },
  { term: 'STCG', category: 'taxes', definition: 'Short-Term Capital Gains — profit from selling equity held for less than 12 months. Taxed at 20% (Budget 2024–25).', example: 'Selling Infosys shares after 6 months at a profit of ₹10,000 attracts 20% STCG tax = ₹2,000.' },
  { term: 'TDS', category: 'taxes', definition: 'Tax Deducted at Source — income tax deducted by the payer at the time of payment (e.g., bank deducts TDS on FD interest).', example: 'If FD interest exceeds ₹40,000/year, the bank deducts 10% TDS.' },
  { term: 'Futures', category: 'derivatives', definition: 'A standardised contract to buy or sell an asset at a predetermined price on a future date. Both parties are obligated.', example: 'Nifty 50 futures allow traders to bet on the index\'s direction without buying all 50 stocks.' },
  { term: 'Options', category: 'derivatives', definition: 'A contract giving the right (not obligation) to buy (call) or sell (put) an asset at a set price before expiry.', example: 'Buying a TCS call option at strike ₹4,000 gives you the right to buy TCS at ₹4,000 before expiry.' },
  { term: 'Volatility', category: 'risk', definition: 'The degree to which an investment\'s price fluctuates. Higher volatility = higher risk and potential return.', example: 'Small-cap stocks have higher volatility than large-cap stocks like Reliance or TCS.' },
  { term: 'Diversification', category: 'risk', definition: 'Spreading investments across different assets, sectors or geographies to reduce concentration risk.', example: 'Holding Reliance, HDFC Bank, ITC, and an index fund is more diversified than only holding one stock.' },
  { term: 'SEBI', category: 'regulation', definition: 'Securities and Exchange Board of India — the regulator of Indian securities markets (exchanges, brokers, mutual funds, etc.).', example: 'SEBI mandates that all listed companies disclose quarterly financial results.' },
  { term: 'NSE', category: 'regulation', definition: 'National Stock Exchange of India — the largest stock exchange by trading volume, home of the Nifty 50 index.', example: 'Most equity derivatives in India trade on NSE.' },
  { term: 'BSE', category: 'regulation', definition: 'Bombay Stock Exchange — Asia\'s oldest exchange (est. 1875), home of the Sensex (BSE 30).', example: 'Over 5,000 companies are listed on BSE.' },
  { term: 'Nifty 50', category: 'indices', definition: 'An index of the 50 largest companies by free-float market cap on NSE. Used as a benchmark for Indian equity.', example: 'Most Indian index funds track the Nifty 50.' },
  { term: 'Sensex', category: 'indices', definition: 'The S&P BSE Sensex — an index of the 30 largest, most liquid companies on BSE.', example: 'When people say "the market is up today", they often mean the Sensex or Nifty rose.' },
];

const MARKET_EVENTS_SEED = [
  {
    title: 'RBI Monetary Policy Committee Meeting — Rate Decision',
    description: 'The RBI MPC meets to set the repo rate. Changes in the repo rate affect bank lending rates, bond yields and equity valuations. This is an educational scenario showing how central bank actions ripple through markets.',
    event_date: '2024-06-07',
    event_type: 'EDUCATIONAL',
  },
  {
    title: 'Union Budget 2024–25 — Capital Gains Tax Changes',
    description: 'On July 23, 2024, the Finance Minister announced changes to capital gains tax: STCG on equity raised from 15% to 20%, LTCG raised from 10% to 12.5%, and the LTCG exemption raised from ₹1 lakh to ₹1.25 lakh. Markets reacted with initial volatility.',
    event_date: '2024-07-23',
    event_type: 'EDUCATIONAL',
  },
  {
    title: 'Q3 FY25 Earnings Season — IT Sector',
    description: 'Indian IT companies (TCS, Infosys, Wipro, HCL) report Q3 earnings. Watch for revenue growth, margins and guidance — these affect the entire Nifty IT index.',
    event_date: '2025-01-10',
    event_type: 'EDUCATIONAL',
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding database...');

    // ── Stocks ───────────────────────────────────────────────
    console.log('  Seeding stocks...');
    for (const s of STOCKS) {
      await client.query(
        `INSERT INTO stocks (symbol, name, sector, description)
         VALUES ($1,$2,$3,$4) ON CONFLICT (symbol) DO NOTHING`,
        [s.symbol, s.name, s.sector, s.description]
      );
    }

    // ── Historical prices (synthetic) ────────────────────────
    console.log('  Seeding historical prices (SYNTHETIC_SAMPLE)...');
    for (const [symbol, startPrice] of Object.entries(START_PRICES)) {
      const prices = generatePrices(symbol, startPrice);
      for (const p of prices) {
        await client.query(
          `INSERT INTO historical_prices (symbol, trade_date, open, high, low, close, volume, data_source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (symbol, trade_date) DO NOTHING`,
          [p.symbol, p.trade_date, p.open, p.high, p.low, p.close, p.volume, p.data_source]
        );
      }
    }

    // ── Courses ──────────────────────────────────────────────
    console.log('  Seeding courses...');
    const courseIdMap: Record<string, string> = {};
    for (const c of COURSES) {
      const r = await client.query(
        `INSERT INTO courses (slug, title, category, description, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description
         RETURNING id`,
        [c.slug, c.title, c.category, c.description, c.sort_order]
      );
      courseIdMap[c.slug] = r.rows[0].id;
    }

    // ── Lessons ──────────────────────────────────────────────
    console.log('  Seeding lessons and quizzes...');
    for (const l of LESSONS_DATA) {
      const courseId = courseIdMap[l.course_slug];
      if (!courseId) { console.warn(`  ⚠️  No course for slug: ${l.course_slug}`); continue; }

      const lr = await client.query(
        `INSERT INTO lessons (course_id, slug, title, read_time_min, objectives, body_md, key_terms, key_takeaways, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (course_id, slug) DO UPDATE SET title=EXCLUDED.title, body_md=EXCLUDED.body_md, key_terms=EXCLUDED.key_terms, key_takeaways=EXCLUDED.key_takeaways
         RETURNING id`,
        [courseId, l.slug, l.title, l.read_time_min, JSON.stringify(l.objectives), l.body_md, JSON.stringify(l.key_terms), JSON.stringify(l.key_takeaways), l.sort_order]
      );
      const lessonId = lr.rows[0].id;

      // Create quiz with 2 MCQ questions per lesson
      const qzr = await client.query(
        `INSERT INTO quizzes (lesson_id, pass_mark) VALUES ($1, 70)
         ON CONFLICT DO NOTHING RETURNING id`,
        [lessonId]
      );
      if (qzr.rows.length > 0) {
        const quizId = qzr.rows[0].id;
        // Generic 2 questions per quiz (kept brief — real content would be lesson-specific)
        await client.query(
          `INSERT INTO questions (quiz_id, question_text, options, correct_index, explanation, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [quizId, `What is the main topic of "${l.title}"?`,
           JSON.stringify([l.key_takeaways[0] || 'Understanding the concept', 'Speculation and gambling', 'Avoiding taxes illegally', 'None of the above']),
           0, `The lesson focuses on: ${l.key_takeaways[0] || 'the core concept'}`, 1]
        );
        await client.query(
          `INSERT INTO questions (quiz_id, question_text, options, correct_index, explanation, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [quizId, `Which term is defined as: "${l.key_terms[0]?.def || 'A financial concept'}"?`,
           JSON.stringify([l.key_terms[0]?.term || 'Asset', 'Speculation', 'Gambling', 'None']),
           0, `Correct: ${l.key_terms[0]?.term || 'Asset'}`, 2]
        );
      }
    }

    // ── Glossary ─────────────────────────────────────────────
    console.log('  Seeding glossary...');
    for (const g of GLOSSARY_SEED) {
      await client.query(
        `INSERT INTO glossary_terms (term, category, definition, example)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [g.term, g.category, g.definition, g.example || null]
      );
    }

    // ── Badges ───────────────────────────────────────────────
    console.log('  Seeding badges...');
    for (const b of BADGES_SEED) {
      await client.query(
        `INSERT INTO badges (code, name, description, icon) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
        [b.code, b.name, b.description, b.icon]
      );
    }

    // ── Challenges ───────────────────────────────────────────
    console.log('  Seeding challenges...');
    for (const c of CHALLENGES_SEED) {
      await client.query(
        `INSERT INTO challenges (code, title, description, xp_reward, sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.title, c.description, c.xp_reward, c.sort_order]
      );
    }

    // ── Market events ────────────────────────────────────────
    console.log('  Seeding market events...');
    for (const e of MARKET_EVENTS_SEED) {
      await client.query(
        `INSERT INTO market_events (title, description, event_date, event_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [e.title, e.description, e.event_date, e.event_type]
      );
    }

    console.log('✅ Seed complete.');
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
