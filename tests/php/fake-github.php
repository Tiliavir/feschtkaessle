<?php

// Stand-in for the GitHub API in tests/php/feedback-test.sh: stores each request,
// answers 201 or the status written to status.txt.
declare(strict_types=1);

$dir = getenv('FAKE_DIR');
$count = count(glob($dir . '/request-*.json'));
file_put_contents($dir . '/request-' . ($count + 1) . '.json', json_encode([
    'path' => $_SERVER['REQUEST_URI'],
    'auth' => $_SERVER['HTTP_AUTHORIZATION'] ?? '',
    'issue' => json_decode((string) file_get_contents('php://input'), true),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
$status = is_file($dir . '/status.txt') ? (int) file_get_contents($dir . '/status.txt') : 201;
http_response_code($status);
header('Content-Type: application/json');
echo '{"number":1}';
