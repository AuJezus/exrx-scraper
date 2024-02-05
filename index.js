import * as cheerio from "cheerio";
import * as fs from "fs";
import * as cliProgress from "cli-progress";
import chalk from "chalk";

// Fetch and get the cheerio page
async function getCheerioDom(link) {
  try {
    const res = await fetch(link);
    const text = await res.text();

    const $ = cheerio.load(text);
    return $;
  } catch (error) {
    console.log(error, link);
  }
}

// Get all of the muscle group links
async function getMuscleGroupLinks() {
  const $ = await getCheerioDom("https://exrx.net/Lists/Directory");

  const muscleGroupAnchors = $(".col-sm-6 > ul > li > a");
  const muscleGroupLinks = muscleGroupAnchors
    .map((i, e) => {
      let link = $(e).attr("href");

      if (!link.startsWith("https")) {
        link = `https://exrx.net/Lists/${link}`;
      }

      return link;
    })
    .toArray();

  return muscleGroupLinks;
}

// Get all of the available excersizes from each muscle group
let totalExcersizes = 0;
async function getMuscleGroupExcersizeLinks(muscleGroupLinks) {
  const excersizeLinks = await Promise.all(
    muscleGroupLinks.map(async (link) => {
      const $ = await getCheerioDom(link);

      // Get muscle group name
      const pageTitle = $("h1.page-title").text();
      const muscleGroup = pageTitle.slice(0, pageTitle.lastIndexOf(" "));

      // Get excersize elements
      const muscleNames = $(".container h2")
        .map((i, e) => $(e).text())
        .toArray();
      const excersizeSections = $("article .container:has(ul)"); //li:not(.premium) a

      // Convert data to nicely formatted object
      const musclesWithExcersizes = excersizeSections
        .map((i, e) => {
          // Get all excersize <a> elements that are free
          const anchors = $(e).find("li:not(.premium) > a");
          const links = anchors
            .map((i, a) => {
              const href = $(a).attr("href");

              // Filter non excersizes
              if (!href.startsWith("../") && !href.startsWith("https://"))
                return null;

              if (!href.startsWith("https://")) {
                // Convert from relative to absolute link
                const converted = href
                  .split("/")
                  .filter((n) => n !== "..")
                  .join("/");

                return "https://exrx.net/" + converted;
              }

              return href;
            })
            .toArray();

          totalExcersizes += links.length;
          return { name: muscleNames[i], excersizes: links };
        })
        .toArray();

      return {
        muscleGroup,
        muscles: musclesWithExcersizes,
      };
    })
  );

  return excersizeLinks;
}

// Get excersize data
async function getExcersizeData(excersizeLink) {
  const $ = await getCheerioDom(excersizeLink);

  // Get name
  const name = $("h1.page-title").text();

  // Get target muscles
  const muscleSection = $(".ad-banner-block .col-sm-6:last-of-type");
  const targetMuscles = $(muscleSection)
    .find("ul:first-of-type li")
    .map((i, el) => $(el).text().trim())
    .toArray();

  // Get classification [utility, mechanics, force]
  const [utility, mechanics, force] = $(
    ".ad-banner-block .col-sm-6:first-of-type table td:nth-of-type(even)"
  )
    .map((i, el) => $(el).text())
    .toArray();

  return {
    name,
    targetMuscles,
    classification: { utility, mechanics, force },
  };
}

// Get all of the excersizes data in sequence (doing it in parallel will crash the website)
async function getExcersizesData(excersizeLinks) {
  for (const [gI, muscleGroup] of excersizeLinks.entries()) {
    for (const [mI, muscle] of muscleGroup.muscles.entries()) {
      for (const [eI, excersize] of muscle.excersizes.entries()) {
        excersizeLinks[gI].muscles[mI].excersizes[eI] = await getExcersizeData(
          excersize
        );
        progressBar.increment();
      }
    }
  }

  return excersizeLinks;
}

// 1) Getting the muscle group link array
const muscleGroupLinks = await getMuscleGroupLinks();
console.log(
  chalk.yellow(
    `Found ${chalk.green(
      muscleGroupLinks.length
    )} muscle groups, getting excersize links...`
  )
);

// 2) For each muscle group scrape all available excersizes links and format/filter it by individual muscle.
const excersizeLinks = await getMuscleGroupExcersizeLinks(muscleGroupLinks);

console.log(
  chalk.yellow(
    `Total of ${chalk.green(totalExcersizes)} free excersizes found.`
  )
);

const progressBar = new cliProgress.SingleBar(
  {
    format: chalk.cyan(
      `Scraping excersize data | ${chalk.magenta(
        "{bar} {percentage}%"
      )} | ${chalk.yellow("ETA: {eta}s")} | ${chalk.red("{value}/{total}")}`
    ),
  },
  cliProgress.Presets.shades_classic
);
progressBar.start(totalExcersizes, 0);

// 3) Scrape data from all of the excersize links in sequence
const excersizes = await getExcersizesData(excersizeLinks);
progressBar.stop();

// 4) Save to file
console.log(chalk.yellow("Saving data to json file..."));
const jsonString = JSON.stringify(excersizes);
fs.writeFile("data.json", jsonString, (err) => {});
console.log(chalk.green("Done!"));
