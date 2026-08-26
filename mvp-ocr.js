(function createLocalOcrEngine(global) {
  'use strict';

  const PARSER_VERSION = '0.6.0';
  const RECONCILIATION_TOLERANCE = 10;
  const AMBIGUOUS_LABELS = new Set(['服务', '其他', '购物', '转账', '商业服务', '亲友代付']);
  const EXCLUDED_BY_DEFAULT = new Set(['转账', '亲友代付']);

  const CATALOGS = {
    wechat: [
      ['生活缴费', '住', '其他', ['生活交费']], ['充值缴费', '住', '其他', ['充值交费']],
      ['医疗', '健康', '看病', ['医疔']], ['餐饮', '吃', '外食', ['餐钦']], ['咖啡', '吃', '咖啡奶茶', []],
      ['外卖', '吃', '外卖简餐', ['外食']], ['交通', '行', '其他', ['交道', '交运']], ['旅行', '娱乐', '旅行', []],
      ['运动', '健康', '运动', []], ['保险', '健康', '保险', []], ['购物', '用', '日用百货', []],
      ['服务', '其他', '其他', []], ['转账', '人情', '其他', ['转帐']], ['其他', '其他', '其他', []]
    ],
    alipay: [
      ['餐饮美食', '吃', '外食', ['餐钦美食']], ['交通出行', '行', '其他', ['交通出仃']],
      ['日用百货', '用', '日用百货', []], ['数码电器', '用', '数码电器', []],
      ['家居家装', '住', '其他', []], ['充值缴费', '住', '其他', ['充值交费']],
      ['服饰装扮', '穿', '衣服', []], ['美容美发', '美', '美发', []],
      ['文化休闲', '娱乐', '影音', []], ['教育培训', '成长', '其他', []],
      ['母婴亲子', '宝', '其他', []], ['医疗健康', '健康', '看病', []],
      ['亲友代付', '人情', '其他', []], ['商业服务', '其他', '其他', []], ['宠物', '其他', '宠物', []]
    ]
  };
  const ALIPAY_CHILD_CATALOG = [
    ['正餐', '餐饮美食', '吃', '外食', []],
    ['咖啡奶茶', '餐饮美食', '吃', '咖啡奶茶', ['咖啡茶饮']],
    ['生鲜水果', '餐饮美食', '吃', '生鲜采购', ['生鲜果蔬']],
    ['零食', '餐饮美食', '吃', '零食', []],
    ['外卖', '餐饮美食', '吃', '外卖简餐', []],
    ['打车租车', '交通出行', '行', '打车', ['打车用车']],
    ['公交地铁', '交通出行', '行', '地铁公交', ['地铁公交']],
    ['机票火车票', '交通出行', '行', '高铁飞机', ['火车飞机']],
    ['休闲娱乐', '文化休闲', '娱乐', '影音', []],
    ['图书', '文化休闲', '成长', '读书', []],
    ['手机充值', '充值缴费', '住', '其他', []],
    ['护肤彩妆', '美容美发', '美', '护肤', ['美容护肤']]
  ];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const sum = (values) => values.reduce((total, value) => total + Number(value || 0), 0);
  const normalizeLine = (value) => String(value || '')
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[￥]/g, '¥')
    .replace(/[ＯOo〇]/g, '0')
    .replace(/\s+/g, ' ')
    .trim();

  function levenshtein(left, right) {
    const matrix = Array.from({ length: right.length + 1 }, (_, row) => [row]);
    for (let column = 0; column <= left.length; column += 1) matrix[0][column] = column;
    for (let row = 1; row <= right.length; row += 1) {
      for (let column = 1; column <= left.length; column += 1) {
        matrix[row][column] = right[row - 1] === left[column - 1]
          ? matrix[row - 1][column - 1]
          : Math.min(matrix[row - 1][column - 1] + 1, matrix[row][column - 1] + 1, matrix[row - 1][column] + 1);
      }
    }
    return matrix[right.length][left.length];
  }

  function categoryMatch(line, platform) {
    const compact = normalizeLine(line).replace(/[\s\d.,%¥￥()（）<>·:：/\\_-]/g, '');
    const catalog = CATALOGS[platform] || [];
    for (const [label, unified, subcategory, aliases] of catalog) {
      if (compact.includes(label)) return { label, unified, subcategory, confidence: 98, matchType: 'exact' };
      const alias = aliases.find((candidate) => compact.includes(candidate));
      if (alias) return { label, unified, subcategory, confidence: 82, matchType: 'alias' };
    }
    const tokens = compact.match(/[\u3400-\u9fff]{2,8}/g) || [];
    let best = null;
    for (const [label, unified, subcategory] of catalog) {
      for (const token of tokens) {
        if (Math.abs(token.length - label.length) > 1) continue;
        const distance = levenshtein(token, label);
        const allowed = label.length >= 4 ? 2 : 1;
        if (distance <= allowed && (!best || distance < best.distance)) {
          best = { label, unified, subcategory, confidence: distance === 1 ? 72 : 62, matchType: 'fuzzy', distance };
        }
      }
    }
    return best;
  }

  function amountFromLine(line) {
    const normalized = normalizeLine(line);
    const currencyMatches = [...normalized.matchAll(/[¥￥Y#f{]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)];
    const decimalMatches = [...normalized.matchAll(/(?:^|\s)([0-9][0-9,]*\.[0-9]{2})(?!\s*%)/g)];
    const raw = currencyMatches.at(-1)?.[1] || decimalMatches.at(-1)?.[1];
    if (!raw) return null;
    const amount = Number(raw.replace(/,/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  function amountsFromLine(line) {
    const normalized = normalizeLine(line);
    return [...normalized.matchAll(/[¥￥Y#f{]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)]
      .map((match) => Number(match[1].replace(/,/g, '')))
      .filter((amount) => Number.isFinite(amount) && amount >= 0);
  }

  function alipayChildMatch(line) {
    const compact = normalizeLine(line).replace(/[\s\d.,%¥￥()（）<>·:：/\\_-]/g, '');
    for (const [label, parentSource, category, subcategory, aliases] of ALIPAY_CHILD_CATALOG) {
      if (compact.includes(label)) return { label, parentSource, category, subcategory, confidence: 98, matchType: 'exact' };
      const alias = aliases.find((candidate) => compact.includes(candidate));
      if (alias) return { label, parentSource, category, subcategory, confidence: 82, matchType: 'alias' };
    }
    return null;
  }

  function alipayChildEntriesFromText(text, ocrConfidence, allowSequential = true) {
    const lines = String(text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const found = [];
    for (let index = 0; index < lines.length; index += 1) {
      const match = alipayChildMatch(lines[index]);
      if (!match) continue;
      let amount = amountFromLine(lines[index]);
      if (amount === null && allowSequential) {
        for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
          if (alipayChildMatch(lines[index + offset]) || categoryMatch(lines[index + offset], 'alipay')) break;
          amount = amountFromLine(lines[index + offset]);
          if (amount !== null) break;
        }
      }
      if (amount === null || amount <= 0) continue;
      const confidence = clamp(Math.round(Number(ocrConfidence || 0) * 0.55 + match.confidence * 0.45), 1, 99);
      found.push({
        source: match.label,
        parentSource: match.parentSource,
        amount,
        category: match.category,
        subcategory: match.subcategory,
        note: '',
        confidence,
        needsConfirm: match.matchType !== 'exact' || confidence < 85,
        confirmed: match.matchType === 'exact' && confidence >= 85,
        include: true,
        inputMethod: 'ocr',
        hierarchyLevel: 2,
        reason: '支付宝展开的二级分类，已用一级总额校验'
      });
    }
    const deduplicated = new Map();
    found.forEach((entry) => {
      const key = `${entry.parentSource}|${entry.source}`;
      const current = deduplicated.get(key);
      if (!current || entry.amount > current.amount || entry.confidence > current.confidence) deduplicated.set(key, entry);
    });
    return [...deduplicated.values()];
  }

  function childEntry(match, amount, ocrConfidence, reason) {
    const confidence = clamp(Math.round(Number(ocrConfidence || 0) * 0.55 + match.confidence * 0.45), 1, 99);
    return {
      source: match.label,
      parentSource: match.parentSource,
      amount,
      category: match.category,
      subcategory: match.subcategory,
      note: '',
      confidence,
      needsConfirm: match.matchType !== 'exact' || confidence < 85,
      confirmed: match.matchType === 'exact' && confidence >= 85,
      include: true,
      inputMethod: 'ocr',
      hierarchyLevel: 2,
      reason
    };
  }

  function alipayGridEntriesFromText(documents, ocrConfidence) {
    const found = [];
    documents.forEach((document) => {
      const lines = String(document.text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
      let currentParent = null;
      for (let index = 0; index < lines.length; index += 1) {
        const parentMatch = categoryMatch(lines[index], 'alipay');
        const directChild = alipayChildMatch(lines[index]);
        if (parentMatch && !directChild) currentParent = parentMatch;
        const matches = [];
        ALIPAY_CHILD_CATALOG.forEach(([label, parentSource, category, subcategory, aliases]) => {
          const candidates = [label, ...aliases];
          const position = Math.min(...candidates.map((candidate) => lines[index].indexOf(candidate)).filter((value) => value >= 0));
          if (Number.isFinite(position)) matches.push({ label, parentSource, category, subcategory, confidence: 98, matchType: 'exact', position });
        });
        const otherPosition = lines[index].indexOf('其他');
        if (otherPosition >= 0 && currentParent) {
          matches.push({ label: '其他', parentSource: currentParent.label, category: currentParent.unified, subcategory: '其他', confidence: 88, matchType: 'layout', position: otherPosition });
        }
        matches.sort((left, right) => left.position - right.position);
        if (matches.length < 2) continue;
        let amounts = amountsFromLine(lines[index]);
        for (let offset = 1; amounts.length < matches.length && offset <= 3 && index + offset < lines.length; offset += 1) {
          amounts = amounts.concat(amountsFromLine(lines[index + offset]));
        }
        if (amounts.length < matches.length) continue;
        matches.forEach((match, matchIndex) => {
          if (amounts[matchIndex] > 0) found.push(childEntry(match, amounts[matchIndex], ocrConfidence, '支付宝同排网格按标签与金额的左右顺序配对，并用一级总额校验'));
        });
      }
    });
    return found;
  }

  function alipayChildEntriesFromLayout(documents, ocrConfidence) {
    const found = [];
    documents.forEach((document) => {
      const lines = Array.isArray(document.lines) ? document.lines.filter((line) => line?.bbox) : [];
      const parentLines = lines.map((line) => ({ line, match: categoryMatch(line.text, 'alipay') }))
        .filter((item) => item.match && !alipayChildMatch(item.line.text));
      const amountLines = lines.map((line, index) => ({ ...line, index, amount: amountFromLine(line.text) })).filter((line) => line.amount !== null);
      const usedAmounts = new Set();
      lines.forEach((line) => {
        let match = alipayChildMatch(line.text);
        const compact = normalizeLine(line.text).replace(/[\s\d.,%¥￥()（）<>·:：/\\_-]/g, '');
        if (!match && compact === '其他') {
          const parent = parentLines.filter((item) => item.line.bbox.y1 <= line.bbox.y0 && line.bbox.y0 - item.line.bbox.y1 <= 1600)
            .sort((left, right) => right.line.bbox.y1 - left.line.bbox.y1)[0];
          if (parent) match = {
            label: '其他', parentSource: parent.match.label, category: parent.match.unified,
            subcategory: '其他', confidence: 88, matchType: 'layout'
          };
        }
        if (!match) return;
        const inlineAmount = amountFromLine(line.text);
        let amount = inlineAmount;
        if (amount === null) {
          const labelCenterX = (line.bbox.x0 + line.bbox.x1) / 2;
          const candidates = amountLines.filter((candidate) => {
            if (usedAmounts.has(candidate.index)) return false;
            const verticalGap = candidate.bbox.y0 - line.bbox.y1;
            const amountCenterX = (candidate.bbox.x0 + candidate.bbox.x1) / 2;
            return verticalGap >= -18 && verticalGap <= 220 && Math.abs(amountCenterX - labelCenterX) <= 190;
          }).map((candidate) => ({
            ...candidate,
            score: Math.max(0, candidate.bbox.y0 - line.bbox.y1) * 2 + Math.abs(candidate.bbox.x0 - line.bbox.x0)
          })).sort((left, right) => left.score - right.score);
          if (candidates.length) {
            amount = candidates[0].amount;
            usedAmounts.add(candidates[0].index);
          }
        }
        if (amount === null || amount <= 0) return;
        found.push(childEntry(match, amount, ocrConfidence, '支付宝展开的二级分类，按截图位置匹配金额并用一级总额校验'));
      });
    });
    const deduplicated = new Map();
    found.forEach((entry) => {
      const key = `${entry.parentSource}|${entry.source}`;
      const current = deduplicated.get(key);
      if (!current || entry.confidence >= current.confidence) deduplicated.set(key, entry);
    });
    return [...deduplicated.values()];
  }

  function parentEntry(match, amount, ocrConfidence, reason = '') {
    const confidence = clamp(Math.round(Number(ocrConfidence || 0) * 0.55 + match.confidence * 0.45), 1, 99);
    const ambiguous = AMBIGUOUS_LABELS.has(match.label);
    const fuzzy = match.matchType !== 'exact';
    const excluded = EXCLUDED_BY_DEFAULT.has(match.label);
    return {
      source: match.label,
      amount,
      category: match.unified,
      subcategory: match.subcategory,
      note: '',
      confidence,
      needsConfirm: ambiguous || fuzzy || confidence < 85,
      confirmed: !(ambiguous || fuzzy || confidence < 85),
      include: !excluded,
      inputMethod: 'ocr',
      reason: excluded ? '转账或代付不一定属于消费，请确认是否计入' : ambiguous ? '平台分类范围较宽，请确认统一分类' : fuzzy ? '分类名称为模糊匹配，请确认' : reason
    };
  }

  function parentEntriesFromLayout(platform, documents, ocrConfidence) {
    if (platform === 'wechat') return wechatEntriesFromLayout(documents, ocrConfidence);
    const found = [];
    documents.forEach((document) => {
      const lines = Array.isArray(document.lines) ? document.lines.filter((line) => line?.bbox) : [];
      const amountLines = lines.map((line, index) => ({ ...line, index, amount: amountFromLine(line.text) })).filter((line) => line.amount !== null);
      const usedAmounts = new Set();
      lines.forEach((line) => {
        const match = categoryMatch(line.text, platform);
        if (!match || (platform === 'alipay' && alipayChildMatch(line.text))) return;
        let amount = amountFromLine(line.text);
        if (amount === null) {
          const labelCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
          const labelCenterX = (line.bbox.x0 + line.bbox.x1) / 2;
          const candidates = amountLines.filter((candidate) => {
            if (usedAmounts.has(candidate.index) || candidate.index === lines.indexOf(line)) return false;
            const amountCenterY = (candidate.bbox.y0 + candidate.bbox.y1) / 2;
            const amountCenterX = (candidate.bbox.x0 + candidate.bbox.x1) / 2;
            const sameRow = Math.abs(amountCenterY - labelCenterY) <= 75 && candidate.bbox.x0 >= line.bbox.x0;
            const directlyBelow = candidate.bbox.y0 >= line.bbox.y1 - 15 && candidate.bbox.y0 - line.bbox.y1 <= 130 && Math.abs(amountCenterX - labelCenterX) <= 210;
            return sameRow || directlyBelow;
          }).map((candidate) => {
            const amountCenterY = (candidate.bbox.y0 + candidate.bbox.y1) / 2;
            const amountCenterX = (candidate.bbox.x0 + candidate.bbox.x1) / 2;
            return { ...candidate, score: Math.abs(amountCenterY - labelCenterY) * 5 + Math.abs(amountCenterX - labelCenterX) };
          }).sort((left, right) => left.score - right.score);
          if (candidates.length) {
            amount = candidates[0].amount;
            usedAmounts.add(candidates[0].index);
          }
        }
        if (amount === null || amount <= 0) return;
        found.push(parentEntry(match, amount, ocrConfidence, '按截图中分类与金额的位置关系识别'));
      });
    });
    const deduplicated = new Map();
    found.forEach((entry) => {
      const current = deduplicated.get(entry.source);
      if (!current || entry.confidence >= current.confidence) deduplicated.set(entry.source, entry);
    });
    return [...deduplicated.values()];
  }

  function wechatEntriesFromLayout(documents, ocrConfidence) {
    const imageTotals = new Map();
    [...new Set(documents.map((document) => document.imageId).filter(Boolean))].forEach((imageId) => {
      imageTotals.set(imageId, totalFromDocuments(documents.filter((document) => document.imageId === imageId)));
    });
    const groups = new Map();
    documents.forEach((document) => {
      const key = document.segmentId || document.imageId || 'wechat';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(document);
    });
    const found = [];
    groups.forEach((groupDocuments) => {
      const observed = groupDocuments.flatMap((document) => (Array.isArray(document.lines) ? document.lines : [])
        .filter((line) => line?.bbox)
        .map((line, index) => ({ ...line, index, variant: document.variant || 'original' })));
      const amountLines = observed.map((line) => ({ ...line, amount: amountFromLine(line.text) }))
        .filter((line) => line.amount !== null && line.amount > 0 && !/%/.test(line.text)
          && (/[¥￥Y#f{]/i.test(line.text) || (/list-right/.test(line.variant) && line.amount >= 100)));
      const imageTotal = imageTotals.get(groupDocuments[0]?.imageId) || null;
      const sourcePercents = new Map();
      observed.forEach((line) => {
        const match = categoryMatch(line.text, 'wechat');
        if (!match || /[¥￥Y]/i.test(line.text)) return;
        const numeric = normalizeLine(line.text).match(/(\d{1,2}(?:\.\d{1,4})?)/);
        const percent = Number(numeric?.[1]);
        if (Number.isFinite(percent) && percent >= 0 && percent <= 100) sourcePercents.set(match.label, percent);
      });
      const rightRows = [];
      amountLines.filter((line) => /wechat-list-(?:right|contrast|original)/.test(line.variant)).forEach((line) => {
        const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
        let row = rightRows.find((item) => Math.abs(item.centerY - centerY) <= 30);
        if (!row) {
          row = { centerY, candidates: [] };
          rightRows.push(row);
        }
        row.candidates.push(line);
      });
      const sortedRows = rightRows.sort((left, right) => left.centerY - right.centerY);
      const rowSequences = [];
      let currentSequence = [];
      sortedRows.forEach((row) => {
        if (!currentSequence.length || (row.centerY - currentSequence.at(-1).centerY >= 120 && row.centerY - currentSequence.at(-1).centerY <= 280)) {
          currentSequence.push(row);
        } else {
          if (currentSequence.length) rowSequences.push(currentSequence);
          currentSequence = [row];
        }
      });
      if (currentSequence.length) rowSequences.push(currentSequence);
      const listRows = rowSequences.sort((left, right) => right.length - left.length || right[0].centerY - left[0].centerY)[0] || [];
      const selectedAmounts = listRows.map((row) => {
        if (row.candidates.length === 1) return row.candidates[0];
        const amounts = new Map();
        row.candidates.forEach((candidate) => {
          const key = candidate.amount.toFixed(2);
          if (!amounts.has(key)) amounts.set(key, []);
          amounts.get(key).push(candidate);
        });
        return [...amounts.values()].map((candidates) => {
          const candidate = candidates[0];
          const decimals = normalizeLine(candidate.text).match(/\.(\d+)/)?.[1]?.length || 0;
          const sourceDifference = imageTotal && sourcePercents.size
            ? Math.min(...[...sourcePercents.values()].map((percent) => Math.abs(candidate.amount / imageTotal * 100 - percent)))
            : 0;
          return { ...candidate, selectionScore: candidates.length * 3 + (decimals === 2 ? 5 : 0) - sourceDifference };
        }).sort((left, right) => right.selectionScore - left.selectionScore)[0];
      }).filter(Boolean);
      const uniqueSelectedAmounts = [...new Map(selectedAmounts.map((item) => [item.amount.toFixed(2), item])).values()]
        .sort((left, right) => right.amount - left.amount);
      const rankedSources = [...sourcePercents.entries()].sort((left, right) => right[1] - left[1]);
      const rankedAssignments = rankedSources.slice(0, uniqueSelectedAmounts.length).map(([source, percent], index) => ({
        source, percent, amount: uniqueSelectedAmounts[index]?.amount
      })).filter((item) => item.amount > 0);
      if (imageTotal && rankedAssignments.length === rankedSources.length && rankedAssignments.length === uniqueSelectedAmounts.length) {
        const snapshot = rankedAssignments.map((assignment) => ({ ...assignment }));
        const correction = snapshot.map((assignment) => {
          const otherTotal = sum(snapshot.filter((item) => item !== assignment).map((item) => item.amount));
          const residual = Number((imageTotal - otherTotal).toFixed(2));
          const currentDifference = Math.abs(assignment.amount / imageTotal * 100 - assignment.percent);
          const residualDifference = residual > 0 ? Math.abs(residual / imageTotal * 100 - assignment.percent) : Infinity;
          return { assignment, residual, improvement: currentDifference - residualDifference, residualDifference };
        }).filter((item) => item.residualDifference <= 0.28 && item.improvement > 0.28)
          .sort((left, right) => right.improvement - left.improvement)[0];
        if (correction) rankedAssignments.find((item) => item.source === correction.assignment.source).amount = correction.residual;
      }
      rankedAssignments.forEach((assignment) => {
        const match = categoryMatch(assignment.source, 'wechat');
        if (!match) return;
        const entry = parentEntry(match, assignment.amount, ocrConfidence, '微信列表按金额降序，与支出构成百分比顺序交叉校验');
        entry.evidenceScore = 5000;
        found.push(entry);
      });
      const used = new Set();
      observed.forEach((line) => {
        const match = categoryMatch(line.text, 'wechat');
        if (!match) return;
        const labelCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
        const expectedPercent = sourcePercents.get(match.label);
        let candidates = amountLines.filter((candidate) => {
          const amountCenterY = (candidate.bbox.y0 + candidate.bbox.y1) / 2;
          return Math.abs(amountCenterY - labelCenterY) <= 92;
        }).map((candidate) => {
          const amountCenterY = (candidate.bbox.y0 + candidate.bbox.y1) / 2;
          const originalPriority = /original/.test(candidate.variant) ? 0 : 1;
          const separateAmountPriority = candidate.text === line.text ? 1 : 0;
          const percentDifference = imageTotal && Number.isFinite(expectedPercent)
            ? Math.abs(candidate.amount / imageTotal * 100 - expectedPercent)
            : 0;
          return {
            ...candidate,
            percentDifference,
            score: percentDifference * 6000 + originalPriority * 1000 + separateAmountPriority * 220 + Math.abs(amountCenterY - labelCenterY) * 5
          };
        }).sort((left, right) => left.score - right.score);
        if (imageTotal && Number.isFinite(expectedPercent)) {
          const percentCandidates = amountLines.map((item) => ({
              ...item,
              percentDifference: Math.abs(item.amount / imageTotal * 100 - expectedPercent)
            })).filter((item) => item.percentDifference <= 0.28)
              .sort((left, right) => left.percentDifference - right.percentDifference);
          if (percentCandidates.length) {
            candidates = percentCandidates.map((item) => ({ ...item, score: item.percentDifference * 100 }));
          } else {
            candidates = [];
          }
        }
        const candidate = candidates.find((item) => !used.has(`${item.variant}|${item.index}|${item.bbox.y0}|${item.amount}`)) || candidates[0];
        if (!candidate) return;
        used.add(`${candidate.variant}|${candidate.index}|${candidate.bbox.y0}|${candidate.amount}`);
        const entry = parentEntry(match, candidate.amount, ocrConfidence, '微信单层列表按同一行位置配对；金额优先采用原图识别结果');
        entry.evidenceScore = candidate.score;
        found.push(entry);
      });
    });
    const deduplicated = new Map();
    found.forEach((entry) => {
      const current = deduplicated.get(entry.source);
      if (!current || entry.evidenceScore < current.evidenceScore || (entry.evidenceScore === current.evidenceScore && entry.confidence > current.confidence)) {
        deduplicated.set(entry.source, entry);
      }
    });
    return [...deduplicated.values()].map(({ evidenceScore, ...entry }) => entry);
  }

  function resolveAlipayHierarchy(parentEntries, childEntries) {
    return parentEntries.flatMap((parent) => {
      let children = childEntries.filter((entry) => entry.parentSource === parent.source);
      if (!children.length) return [parent];
      const oversized = children.filter((entry) => entry.amount > parent.amount);
      if (oversized.length === 1) {
        const otherTotal = sum(children.filter((entry) => entry !== oversized[0]).map((entry) => entry.amount));
        const residual = Number((parent.amount - otherTotal).toFixed(2));
        if (residual > 0 && residual < parent.amount) {
          children = children.map((entry) => entry === oversized[0]
            ? { ...entry, amount: residual, needsConfirm: true, confirmed: false, reason: '金额小数点疑似漏识别，已由一级总额唯一反算，请人工确认' }
            : entry);
        }
      }
      const childTotal = sum(children.map((entry) => entry.amount));
      const difference = Math.abs(parent.amount - childTotal);
      if (difference < RECONCILIATION_TOLERANCE) {
        return children.map((entry) => ({ ...entry, parentAmount: parent.amount, hierarchyDifference: difference }));
      }
      return [{
        ...parent,
        hierarchyDifference: difference,
        needsConfirm: true,
        confirmed: false,
        reason: `二级合计与一级总额相差 ¥${difference.toFixed(2)}，为避免漏记或重复，已保留一级总额`
      }];
    });
  }

  function detectedMonths(text) {
    const value = String(text || '');
    const direct = [...value.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月/g)]
      .map((match) => `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`);
    const headerAliases = [...value.matchAll(/(20\d{2})\s*(?:年|F€?)\s*(\d{1,2})\s*[月H]/g)]
      .map((match) => `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`);
    // 微信绿色页头中的“8月”常被本地OCR稳定识别为“绷 H”，作为已验证的字形别名处理。
    const augustAliases = [...value.matchAll(/(20\d{2})\s*年\s*[绷朝]\s*[H月]?/g)].map((match) => `${match[1]}-08`);
    return [...new Set([...direct, ...headerAliases, ...augustAliases])];
  }

  function totalFromDocuments(documents) {
    const candidates = [];
    const headerDocuments = documents.filter((document) => /-header$/.test(document.segmentId || ''));
    const sourceDocuments = headerDocuments.length ? headerDocuments : documents;
    sourceDocuments.forEach((document) => {
      const lines = Array.isArray(document.lines) ? document.lines.filter((line) => line?.bbox) : [];
      const maxX = Math.max(1, ...lines.map((line) => line.bbox.x1 || 0));
      const anchors = lines.filter((line) => /支出/.test(line.text) && !/支出构成|支出分类/.test(line.text));
      lines.forEach((line) => {
        const amount = amountFromLine(line.text);
        if (amount === null || amount <= 0 || /%|[&:：]/.test(line.text) || categoryMatch(line.text, 'wechat') || categoryMatch(line.text, 'alipay')) return;
        const height = line.bbox.y1 - line.bbox.y0;
        const leftSide = line.bbox.x0 <= maxX * 0.58;
        const anchorDistance = anchors.reduce((best, anchor) => {
          const gap = line.bbox.y0 - anchor.bbox.y1;
          return gap >= -40 && gap <= 900 ? Math.min(best, Math.abs(gap)) : best;
        }, Infinity);
        if (!leftSide && !Number.isFinite(anchorDistance)) return;
        const score = (Number.isFinite(anchorDistance) ? 0 : 2500) + (Number.isFinite(anchorDistance) ? anchorDistance * 2 : 0) - height * 12 + line.bbox.x0;
        candidates.push({ amount, score, height });
      });
    });
    const credible = candidates.filter((candidate) => candidate.height >= 54 || candidate.score < 2500);
    credible.sort((left, right) => left.score - right.score);
    return credible[0]?.amount ?? null;
  }

  function totalFromText(text, platform) {
    const normalized = String(text || '').replace(/[，]/g, ',').replace(/[￥]/g, '¥').replace(/[ＯOo〇]/g, '0');
    const patterns = platform === 'wechat'
      ? [/共\s*支出[\s\S]{0,35}?[¥￥Y]?\s*([0-9][0-9,]*\.[0-9]{1,2})/i]
      : [
        /本月[\s\S]{0,24}?支出[\s\S]{0,24}?[¥￥Y]\s*([0-9][0-9,]*\.[0-9]{1,2})/i,
        /(?:^|\n)\s*支出\s*[¥￥Y]\s*([0-9][0-9,]*\.[0-9]{1,2})/im
      ];
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (!match) continue;
      const amount = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(amount)) return amount;
    }
    return null;
  }

  function entriesFromText(text, platform, ocrConfidence, documents = []) {
    const lines = String(text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const hasLayoutLines = documents.some((document) => Array.isArray(document.lines) && document.lines.length > 0);
    const found = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/共\s*支出|支出构成|支出分类|月度小结|每日对比|省钱建议/.test(line)) continue;
      const match = categoryMatch(line, platform);
      if (!match) continue;
      if (platform === 'wechat' && !/[¥￥Y]/i.test(line)) {
        const summaryNumber = line.match(/(\d{1,2}(?:\.\d{1,4})?)/);
        if (summaryNumber && Number(summaryNumber[1]) <= 100) continue;
      }
      let amount = amountFromLine(line);
      // 微信是单层列表：当版面坐标可用时，禁止按文字先后顺序猜金额，
      // 避免把上一行的金额错误分配给下一行分类。支付宝父子卡片仍允许短距离顺序兜底。
      if (amount === null && (platform === 'alipay' || !hasLayoutLines)) {
        for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
          if (categoryMatch(lines[index + offset], platform)) break;
          amount = amountFromLine(lines[index + offset]);
          if (amount !== null) break;
        }
      }
      if (amount === null || amount <= 0) continue;
      found.push(parentEntry(match, amount, ocrConfidence));
    }
    const deduplicated = new Map();
    found.forEach((entry) => {
      const current = deduplicated.get(entry.source);
      if (!current || entry.amount > current.amount || entry.confidence > current.confidence) deduplicated.set(entry.source, entry);
    });
    parentEntriesFromLayout(platform, documents, ocrConfidence).forEach((entry) => {
      const current = deduplicated.get(entry.source);
      if (!current || entry.confidence >= current.confidence) deduplicated.set(entry.source, entry);
    });
    let parentEntries = [...deduplicated.values()];
    if (platform === 'wechat') {
      parentEntries = parentEntries.filter((entry) => !/金额降序/.test(entry.reason || '') || !parentEntries.some((other) => (
        other !== entry && Math.abs(other.amount - entry.amount) < 0.005 && !/金额降序/.test(other.reason || '')
      )));
    }
    if (platform !== 'alipay') return parentEntries;
    const childMap = new Map();
    alipayChildEntriesFromText(text, ocrConfidence, !hasLayoutLines).forEach((entry) => childMap.set(`${entry.parentSource}|${entry.source}`, entry));
    alipayChildEntriesFromLayout(documents, ocrConfidence).forEach((entry) => childMap.set(`${entry.parentSource}|${entry.source}`, entry));
    // 同一行包含多个标签时，网格专用解析比单标签版面匹配更可靠，应最后覆盖。
    alipayGridEntriesFromText(documents, ocrConfidence).forEach((entry) => childMap.set(`${entry.parentSource}|${entry.source}`, entry));
    return resolveAlipayHierarchy(parentEntries, [...childMap.values()]);
  }

  function parseDocuments(platform, documents, expectedMonth) {
    const combinedText = documents.map((document) => document.text || '').join('\n');
    const averageConfidence = documents.length ? sum(documents.map((document) => document.confidence || 0)) / documents.length : 0;
    const entries = entriesFromText(combinedText, platform, averageConfidence, documents);
    const categorySum = sum(entries.map((entry) => entry.amount));
    const hasDedicatedHeader = documents.some((document) => /-header$/.test(document.segmentId || ''));
    const detectedTotal = totalFromText(combinedText, platform) ?? (platform === 'wechat' || hasDedicatedHeader ? totalFromDocuments(documents) : null);
    const monthCandidates = detectedMonths(combinedText);
    const detectedMonth = monthCandidates.find((month) => month === expectedMonth) || monthCandidates[0] || null;
    const total = detectedTotal ?? categorySum;
    const totalSource = detectedTotal === null ? 'category_sum' : 'ocr';
    const totalConfirmed = detectedTotal !== null && averageConfidence >= 72;
    const monthConfirmed = detectedMonth === expectedMonth;
    const warnings = [];
    if (!entries.length) warnings.push('没有识别到一级分类');
    if (detectedTotal === null) warnings.push('没有可靠识别到平台总支出，已暂用分类合计');
    if (!detectedMonth) warnings.push('没有识别到账单月份');
    else if (!monthConfirmed) warnings.push(`识别月份为 ${detectedMonth}，与当前复盘月份不一致`);
    if (detectedTotal !== null && Math.abs(detectedTotal - categorySum) >= RECONCILIATION_TOLERANCE) warnings.push('分类合计与平台总支出差额较大，可能存在漏识别');
    if (platform === 'wechat' && entries.length > 0 && entries.length < 4) warnings.push('微信单层分类识别数量偏少，建议对照截图补充漏项或重新识别');
    return {
      id: platform,
      name: platform === 'wechat' ? '微信' : '支付宝',
      total,
      entries,
      detectedMonth,
      monthConfirmed,
      totalConfirmed,
      totalSource,
      ocrConfidence: Math.round(averageConfidence),
      ocrFileCount: documents.length,
      warnings,
      parserVersion: PARSER_VERSION,
      recognizedAt: new Date().toISOString()
    };
  }

  function progressLabel(status) {
    const labels = {
      'loading tesseract core': '载入本地识别引擎',
      'initializing tesseract': '初始化识别引擎',
      'loading language traineddata': '载入中文识别模型',
      'initializing api': '准备文字识别',
      'recognizing text': '识别截图文字'
    };
    return labels[status] || '准备本地识别';
  }

  const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('长截图拆分失败')), 'image/png');
  });

  function applyWechatContrast(canvas) {
    const context = canvas.getContext('2d', { alpha: false });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
      const value = gray < 205 ? 0 : 255;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  async function prepareSegments(record, platform) {
    const bitmap = await createImageBitmap(record.blob);
    try {
      const segments = [];
      const scale = Math.min(1.6, Math.max(1, 1600 / bitmap.width));
      const makeSegment = async (left, top, sourceWidth, sourceHeight, variant, segmentId, contrast = false) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sourceWidth * scale);
        canvas.height = Math.round(sourceHeight * scale);
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, left, top, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        if (contrast) applyWechatContrast(canvas);
        segments.push({ imageId: record.id, segmentId, blob: await canvasToBlob(canvas), variant });
      };
      if (platform === 'wechat') {
        const headerHeight = Math.max(520, Math.round(bitmap.height * 0.43));
        const listTop = Math.round(bitmap.height * 0.22);
        const listHeight = Math.min(bitmap.height - listTop, Math.round(bitmap.height * 0.72));
        await makeSegment(0, 0, bitmap.width, headerHeight, 'wechat-header-contrast', `${record.id}-header`, true);
        await makeSegment(0, listTop, bitmap.width, listHeight, 'wechat-list-original', `${record.id}-list`, false);
        await makeSegment(0, listTop, bitmap.width, listHeight, 'wechat-list-contrast', `${record.id}-list`, true);
        await makeSegment(0, listTop, Math.round(bitmap.width * 0.48), listHeight, 'wechat-list-left-contrast', `${record.id}-list`, true);
        await makeSegment(Math.round(bitmap.width * 0.52), listTop, Math.round(bitmap.width * 0.48), listHeight, 'wechat-list-right-original', `${record.id}-list`, false);
        await makeSegment(Math.round(bitmap.width * 0.52), listTop, Math.round(bitmap.width * 0.48), listHeight, 'wechat-list-right-contrast', `${record.id}-list`, true);
        return segments;
      }
      const cropHeight = bitmap.height <= 3400 ? bitmap.height : 3000;
      const step = bitmap.height <= 3400 ? bitmap.height : 2400;
      if (bitmap.height > 4500) {
        await makeSegment(0, 0, bitmap.width, Math.min(1150, bitmap.height), 'alipay-header-contrast', `${record.id}-header`, true);
      }
      for (let top = 0; top < bitmap.height; top += step) {
        const sourceHeight = Math.min(cropHeight, bitmap.height - top);
        await makeSegment(0, top, bitmap.width, sourceHeight, 'alipay-original', `${record.id}-segment-${top}`);
        if (top + sourceHeight >= bitmap.height) break;
      }
      return segments;
    } finally {
      bitmap.close();
    }
  }

  function linesFromBlocks(blocks) {
    return (Array.isArray(blocks) ? blocks : []).flatMap((block) => block.paragraphs || [])
      .flatMap((paragraph) => paragraph.lines || [])
      .map((line) => ({ text: normalizeLine(line.text || ''), bbox: line.bbox }))
      .filter((line) => line.text && line.bbox);
  }

  async function recognizePlatform(platform, records, expectedMonth, onProgress = () => {}, options = {}) {
    if (!global.Tesseract?.createWorker) {
      const error = new Error('本地OCR组件没有成功加载，请检查网络后重试；也可以继续使用人工补录。');
      error.code = 'OCR_LIBRARY_UNAVAILABLE';
      throw error;
    }
    const startedAt = performance.now();
    const documents = [];
    const segments = [];
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      onProgress({ platform, fileIndex: recordIndex, fileCount: records.length, progress: 0, label: '优化长截图' });
      segments.push(...await prepareSegments(records[recordIndex], platform));
    }
    let currentIndex = 0;
    const worker = await global.Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      logger: (message) => onProgress({
        platform,
        fileIndex: currentIndex,
        fileCount: segments.length,
        progress: Number(message.progress || 0),
        status: message.status,
        label: progressLabel(message.status)
      })
    });
    try {
      await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '11' });
      for (currentIndex = 0; currentIndex < segments.length; currentIndex += 1) {
        onProgress({ platform, fileIndex: currentIndex, fileCount: segments.length, progress: 0, status: 'recognizing text', label: '识别截图文字' });
        if (platform === 'wechat' || /contrast/.test(segments[currentIndex].variant)) {
          await worker.setParameters({
            preserve_interword_spaces: '1',
            tessedit_pageseg_mode: /(contrast|list-right)/.test(segments[currentIndex].variant) ? '6' : '11'
          });
        }
        const result = await worker.recognize(segments[currentIndex].blob, {}, { blocks: true });
        documents.push({
          imageId: segments[currentIndex].imageId,
          variant: segments[currentIndex].variant,
          segmentId: segments[currentIndex].segmentId,
          text: result.data.text || '',
          confidence: Number(result.data.confidence || 0),
          lines: linesFromBlocks(result.data.blocks)
        });
      }
    } finally {
      await worker.terminate();
    }
    const parsed = parseDocuments(platform, documents, expectedMonth);
    parsed.ocrFileCount = records.length;
    parsed.ocrSegmentCount = segments.length;
    parsed.durationMs = Math.round(performance.now() - startedAt);
    if (options.includeDebug) {
      parsed.debugDocuments = documents.map((document) => ({
        imageId: document.imageId,
        variant: document.variant,
        segmentId: document.segmentId,
        confidence: document.confidence,
        text: document.text,
        lines: document.lines
      }));
    }
    return parsed;
  }

  global.FinanceOCR = {
    version: PARSER_VERSION,
    recognizePlatform,
    parseDocuments,
    entriesFromText,
    totalFromText,
    totalFromDocuments,
    detectedMonths
  };
})(window);

