// Turns a planned route into (1) plain steps for the model, (2) a Hindi plan written by code,
// used when the model is slow, offline or fails the check, and (3) that check itself.
import { isOpen } from './loops.js';

const HINDI_NUMBERS = ('शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस ' +
  'इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस ' +
  'इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ').split(' ');

export const hindiNumber = (n) => HINDI_NUMBERS[Math.round(n)] ?? String(Math.round(n));

// Place words the model might invent. If one shows up in the speech but in no place on
// today's route, the speech is rejected.
const PLACE_WORDS = [
  'मंदिर', 'मन्दिर', 'मस्जिद', 'गिरजा', 'चर्च', 'बाँध', 'बांध', 'डैम', 'तालाब', 'नदी', 'पुल', 'नहर',
  'मैदान', 'स्टेडियम', 'पार्क', 'बगीचा', 'बाग', 'दुकान', 'चाय', 'होटल', 'ढाबा', 'बाज़ार', 'बाजार', 'हाट',
  'स्कूल', 'विद्यालय', 'अस्पताल', 'चौक', 'चौराहा', 'स्टेशन', 'पेड़', 'पीपल', 'बरगद', 'चबूतरा', 'बेंच', 'कुआँ', 'कुआं',
];

// Attaches names to every place id on the route, pairs each leg with what happens on arrival,
// and collects what is happening today at those places (the pandal, haat day) for the invitation.
export function nameRoute(route, map, now = new Date()) {
  const byId = new Map(map.places.map((p) => [p.id, p]));
  const name = (id) => byId.get(id)?.name ?? id;
  const happening = [...new Set(route.legs.map((l) => l.to))]
    .map((id) => byId.get(id))
    .filter((p) => p?.whenOpen && isOpen(p, now))
    .map((p) => ({ at: p.id, name: p.name, text: p.whenOpen }));
  let next = 0;
  const legs = route.legs.map((leg) => {
    let stop = null;
    if (leg.to !== 'home' && route.stops[next]?.at === leg.to) stop = route.stops[next++];
    return { ...leg, fromName: name(leg.from), toName: name(leg.to), stop };
  });
  return {
    ...route,
    legs,
    stops: route.stops.map((s) => ({ ...s, name: name(s.at) })),
    happening,
  };
}

// Plain English steps, with the exact Hindi place names, for the speech prompt.
export function routeSteps(named) {
  const steps = (named.happening || []).map((h) => `Today at "${h.name}": ${h.text}`);
  named.legs.forEach((leg, i) => {
    const how = [leg.shade && 'mostly in shade', leg.uphill && 'a little uphill, go slowly'].filter(Boolean).join(', ');
    const pause = leg.standingPauses ? `; standing pause once on the way` : '';
    const start = i === 0 ? 'Leave home and walk' : 'Walk';
    steps.push(`${start} from "${leg.fromName}" to "${leg.toName}": ${Math.round(leg.minutes)} minutes${how ? `, ${how}` : ''}${pause}.`);
    if (leg.stop?.restMinutes) {
      steps.push(`At "${leg.toName}", sit on "${leg.stop.sit}" for ${leg.stop.restMinutes} minutes.`);
    } else if (leg.stop) {
      steps.push(`Pass by "${leg.toName}" without stopping${leg.stop.open === false ? ' (it is closed now)' : ''}.`);
    }
  });
  steps.push(`Home again. Whole walk: about ${named.totalMinutes} minutes including rests.`);
  return steps;
}

// The same plan, written by code. Plainer than the model, but always correct.
export function templateSpeech(named, walker) {
  const call = walker.callName || walker.name;
  const lines = [
    ...(named.happening || []).map((h, i) => `${i === 0 ? `${call}, ` : 'और '}${h.text}।`),
    `${named.happening?.length ? 'तो' : call + ','} आज की सैर ऐसे कीजिए।`,
  ];
  named.legs.forEach((leg, i) => {
    const min = `${hindiNumber(leg.minutes)} मिनट`;
    if (leg.to === 'home') lines.push(`फिर ${leg.fromName} से घर लौट आइए, लगभग ${min} लगेंगे।`);
    else if (i === 0) lines.push(`घर से निकल कर ${leg.toName} तक चलिए, लगभग ${min} लगेंगे।`);
    else lines.push(`वहाँ से ${leg.toName} तक चलिए, लगभग ${min}।`);
    if (leg.uphill) lines.push('रास्ते में थोड़ी चढ़ाई है, धीरे-धीरे चलिए।');
    else if (leg.shade && i === 0) lines.push('रास्ते में छाँव है।');
    if (leg.standingPauses) lines.push('बीच में एक बार रुक कर साँस लीजिए।');
    if (leg.stop?.restMinutes) lines.push(`${leg.toName} पहुँच कर ${leg.stop.sit} पर ${hindiNumber(leg.stop.restMinutes)} मिनट आराम कीजिए।`);
    else if (leg.stop) lines.push(`${leg.toName} के पास से आगे बढ़िए।`);
  });
  lines.push(`पूरी सैर लगभग ${hindiNumber(named.totalMinutes)} मिनट की है।`);
  lines.push('फ़ोन जेब में रखिए। कोई जल्दी नहीं है, आराम से घर आइए।');
  return lines.join(' ');
}

// Returns a list of problems; empty means the speech is safe to read to Nana.
export function checkSpeech(speech, named) {
  const problems = [];
  if (/[A-Za-z]/.test(speech)) problems.push('latin_letters');
  if (speech.length < 80) problems.push('too_short');

  const routeText = [
    ...named.legs.flatMap((l) => [l.fromName, l.toName]),
    ...named.stops.map((s) => s.sit || ''),
    ...(named.happening || []).map((h) => h.text),
  ].join(' ');
  for (const word of PLACE_WORDS) {
    if (speech.includes(word) && !routeText.includes(word)) problems.push(`invented:${word}`);
  }
  for (const stop of named.stops) {
    // Accept the full name or its last word ("शिव मंदिर" -> "मंदिर").
    const last = stop.name.split(/\s+/).pop();
    if (!speech.includes(stop.name) && !speech.includes(last)) problems.push(`missing:${stop.name}`);
  }
  return problems;
}
