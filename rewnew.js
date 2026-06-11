const { chromium } = require("playwright");

(async () => {
    const email = process.env.FMC_EMAIL;
    const password = process.env.FMC_PASSWORD;

    const browser = await chromium.launch({
        headless: true
    });

    const page = await browser.newPage();

    try {

        console.log("打开登录页...");

        await page.goto(
            "https://new.freemchost.com/login",
            { waitUntil: "networkidle" }
        );

        // 输入账号密码
        await page.locator('input[type="email"]').fill(email);
        await page.locator('input[type="password"]').fill(password);

        // 点击登录
        await page.getByRole("button", {
            name: /sign in/i
        }).click();

        console.log("等待登录完成...");

        await page.waitForLoadState("networkidle");

        // 打开服务器页面
        await page.goto(
            "https://new.freemchost.com/app/servers/acd4ee93-e824-41b7-b341-d572eb1483ef",
            { waitUntil: "networkidle" }
        );

        console.log("查找续期按钮...");

        // 点击 Renew now
        await page.getByRole("button", {
            name: /renew now/i
        }).click();

        console.log("续期成功");

        await page.waitForTimeout(3000);

    } catch (err) {

        console.error("续期失败：", err);

        await page.screenshot({
            path: "error.png",
            fullPage: true
        });

        process.exit(1);
    }

    await browser.close();

})();
