const normalize=value=>String(value??'').trim().toLocaleLowerCase('ru');
export function evaluateLeadQuality(lead){
  const status=normalize(lead.status),minutes=lead.takeoverMinutes;
  const checks=[{label:'Взят в работу в течение 15 минут',passed:typeof minutes==='number'&&Number.isFinite(minutes)&&minutes>=0&&minutes<=15}];
  if(/^ндз(?:$|[\s\d-])/u.test(status)||status.includes('недозвон')){
    checks.push({label:'ДК [НДЗ] — Да',passed:lead.dk===true});
    checks.push({label:'Мессенджер [НДЗ] — Да',passed:lead.messenger===true});
  }
  if(/прогрев|бирж/u.test(status)){
    checks.push({label:'Указана причина отказа',passed:Boolean(normalize(lead.reason))});
    checks.push({label:'Причина отказа верна — Да (контролёр)',passed:lead.reasonCorrect===true});
    checks.push({label:'Прогрев/биржа не вернули — Да',passed:lead.notReturned===true});
  }
  return {quality:checks.every(check=>check.passed),checks};
}
export function withQuality(lead){const result=evaluateLeadQuality(lead);return {...lead,leadQuality:result.quality,leadQualityIssues:result.checks.filter(check=>!check.passed).map(check=>check.label)};}
