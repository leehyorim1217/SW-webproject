require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();
const API_KEY = process.env.MABINOGI_API_KEY;

const calculateSimilarity = (text, searchTerms) => {
    const normalizeText = str => str.toLowerCase().replace(/\s+/g, '');
    const normalizedText = normalizeText(text);
    
    let score = 0;
    let matchedTerms = 0;
    
    for (const term of searchTerms) {
        const normalizedTerm = normalizeText(term);
        if (normalizedText.includes(normalizedTerm)) {
            matchedTerms++;
            score += normalizedTerm.length;
        }
    }
    
    if (matchedTerms !== searchTerms.length) {
        return { score: 0, matchedTerms, totalTerms: searchTerms.length, isValidMatch: false };
    }
    
    score += 50;
    
    const fullSearchTerm = normalizeText(searchTerms.join(''));
    if (normalizedText.includes(fullSearchTerm)) {
        score += 100;
    }
    
    return { score, matchedTerms, totalTerms: searchTerms.length, isValidMatch: true };
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchItemsWithKeyword = async (originalKeyword, cursor = '', accumulatedItems = [], callCount = 0) => {
    if (cursor) await delay(1000);
    
    const response = await axios.get('https://open.api.nexon.com/mabinogi/v1/auction/list', {
        headers: { 'x-nxopen-api-key': API_KEY },
        params: { keyword: originalKeyword.trim(), cursor }
    });

    const items = response.data.auction_item || [];
    const nextCursor = response.data.next_cursor;

    const searchTerms = originalKeyword.trim().split(/\s+/).filter(term => term.length > 0);

    const itemsWithScore = items.map(item => {
        const nameScore = calculateSimilarity(item.item_name, searchTerms);
        const displayNameScore = calculateSimilarity(item.item_display_name, searchTerms);
        
        let bestScore;
        if (nameScore.isValidMatch && displayNameScore.isValidMatch) {
            bestScore = nameScore.score > displayNameScore.score ? nameScore : displayNameScore;
        } else if (nameScore.isValidMatch) {
            bestScore = nameScore;
        } else if (displayNameScore.isValidMatch) {
            bestScore = displayNameScore;
        } else {
            bestScore = { score: 0, matchedTerms: 0, totalTerms: searchTerms.length, isValidMatch: false };
        }
        
        return {
            ...item,
            relevanceScore: bestScore.score,
            matchedTerms: bestScore.matchedTerms,
            totalTerms: bestScore.totalTerms,
            isValidMatch: bestScore.isValidMatch
        };
    });

    const filtered = itemsWithScore
        .filter(item => item.isValidMatch && item.matchedTerms === searchTerms.length && item.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

    accumulatedItems = accumulatedItems.concat(filtered);

    if (accumulatedItems.length >= 10 || callCount >= 4) {
        return {
            auction_item: accumulatedItems.slice(0, Math.max(10, accumulatedItems.length)),
            next_cursor: nextCursor
        };
    }

    if (!nextCursor) {
        return { auction_item: accumulatedItems, next_cursor: null };
    }

    return fetchItemsWithKeyword(originalKeyword, nextCursor, accumulatedItems, callCount + 1);
};

router.get('/', async (req, res) => {
    let { keyword } = req.query;

    if (!keyword) return res.status(400).json({ error: 'keyword is required' });

    keyword = keyword
        .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')  
        .replace(/\s+/g, ' ')
        .trim();

    if (!keyword) return res.status(400).json({ error: 'keyword가 올바르지 않습니다.' });

    try {
        const result = await fetchItemsWithKeyword(keyword);
        res.json(result);
    } catch (error) {
        if (error.response?.data?.error?.name === 'OPENAPI00007') {
            return res.status(429).json({ 
                error: 'API 호출 제한에 도달했습니다. 잠시 후 다시 시도해주세요.',
                retryAfter: 60
            });
        }
        
        res.status(500).json({ error: 'API 요청 실패' });
    }
});

module.exports = router;