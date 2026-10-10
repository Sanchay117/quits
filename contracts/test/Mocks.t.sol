// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockArcUSDC} from "../src/mocks/MockArcUSDC.sol";
import {MockFiatToken} from "../src/mocks/MockFiatToken.sol";

/// @notice The test doubles also run on the local anvil chain, so they get their own checks against FiatToken's
///         behaviour: 6 decimals, EIP-2612 permits and blocklist enforcement.
contract MockFiatTokenTest is Test {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    MockFiatToken private token;
    address private owner;
    uint256 private ownerKey;
    address private spender = makeAddr("spender");
    address private stranger = makeAddr("stranger");

    function setUp() public {
        token = new MockFiatToken("EURC", "EURC");
        (owner, ownerKey) = makeAddrAndKey("owner");
    }

    function test_metadata() public view {
        assertEq(token.name(), "EURC");
        assertEq(token.symbol(), "EURC");
        assertEq(token.decimals(), 6);
        assertEq(token.version(), "2");
    }

    function test_mintAndTransferFrom() public {
        token.mint(owner, 100e6);
        vm.prank(owner);
        token.approve(spender, 40e6);
        vm.prank(spender);
        token.transferFrom(owner, stranger, 30e6);

        assertEq(token.balanceOf(owner), 70e6);
        assertEq(token.balanceOf(stranger), 30e6);
        assertEq(token.allowance(owner, spender), 10e6);
        assertEq(token.totalSupply(), 100e6);
    }

    function test_transferRevertsAboveBalance() public {
        token.mint(owner, 1e6);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds balance"));
        vm.prank(owner);
        token.transfer(stranger, 1e6 + 1);
    }

    function test_transferFromRevertsAboveAllowance() public {
        token.mint(owner, 10e6);
        vm.prank(owner);
        token.approve(spender, 1e6);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds allowance"));
        vm.prank(spender);
        token.transferFrom(owner, stranger, 2e6);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Permit
    // ---------------------------------------------------------------------------------------------------------------

    function test_domainSeparatorFollowsEip712() public {
        assertEq(token.DOMAIN_SEPARATOR(), _expectedDomainSeparator());
        vm.chainId(5042);
        assertEq(token.DOMAIN_SEPARATOR(), _expectedDomainSeparator(), "recomputed after a chain id change");
    }

    function test_permitSetsAllowanceAndBumpsNonce() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerKey, owner, 5e6, 0, block.timestamp);
        token.permit(owner, spender, 5e6, block.timestamp, v, r, s);
        assertEq(token.allowance(owner, spender), 5e6);
        assertEq(token.nonces(owner), 1);
    }

    function test_permitCannotBeReplayed() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerKey, owner, 5e6, 0, block.timestamp);
        token.permit(owner, spender, 5e6, block.timestamp, v, r, s);
        vm.expectRevert(bytes("EIP2612: invalid signature"));
        token.permit(owner, spender, 5e6, block.timestamp, v, r, s);
    }

    function test_permitRevertsWhenExpired() public {
        vm.warp(1000);
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerKey, owner, 5e6, 0, 999);
        vm.expectRevert(bytes("FiatTokenV2: permit is expired"));
        token.permit(owner, spender, 5e6, 999, v, r, s);
    }

    function test_permitRevertsForWrongSigner() public {
        (, uint256 otherKey) = makeAddrAndKey("other");
        (uint8 v, bytes32 r, bytes32 s) = _sign(otherKey, owner, 5e6, 0, block.timestamp);
        vm.expectRevert(bytes("EIP2612: invalid signature"));
        token.permit(owner, spender, 5e6, block.timestamp, v, r, s);
    }

    function test_permitRejectsMalleableSignature() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerKey, owner, 5e6, 0, block.timestamp);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        vm.expectRevert(bytes("ECRecover: invalid signature 's' value"));
        token.permit(owner, spender, 5e6, block.timestamp, flippedV, r, highS);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Blocklist
    // ---------------------------------------------------------------------------------------------------------------

    function test_blocklistIsSettable() public {
        vm.expectEmit(address(token));
        emit MockFiatToken.Blacklisted(owner);
        token.setBlacklisted(owner, true);
        assertTrue(token.isBlacklisted(owner));

        vm.expectEmit(address(token));
        emit MockFiatToken.UnBlacklisted(owner);
        token.setBlacklisted(owner, false);
        assertFalse(token.isBlacklisted(owner));
    }

    function test_transferRevertsWhenSenderBlocked() public {
        token.mint(owner, 10e6);
        token.setBlacklisted(owner, true);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        vm.prank(owner);
        token.transfer(stranger, 1e6);
    }

    function test_transferRevertsWhenRecipientBlocked() public {
        token.mint(owner, 10e6);
        token.setBlacklisted(stranger, true);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        vm.prank(owner);
        token.transfer(stranger, 1e6);
    }

    function test_transferFromRevertsWhenAnyPartyBlocked() public {
        token.mint(owner, 10e6);
        vm.prank(owner);
        token.approve(spender, 10e6);
        address[3] memory parties = [owner, spender, stranger];
        for (uint256 i; i < 3; ++i) {
            token.setBlacklisted(parties[i], true);
            vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
            vm.prank(spender);
            token.transferFrom(owner, stranger, 1e6);
            token.setBlacklisted(parties[i], false);
        }
        vm.prank(spender);
        token.transferFrom(owner, stranger, 1e6);
        assertEq(token.balanceOf(stranger), 1e6);
    }

    function test_approvePermitAndMintRespectBlocklist() public {
        token.setBlacklisted(owner, true);

        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        vm.prank(owner);
        token.approve(spender, 1);

        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerKey, owner, 1, 0, block.timestamp);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        token.permit(owner, spender, 1, block.timestamp, v, r, s);

        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        token.mint(owner, 1);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------

    function _expectedDomainSeparator() private view returns (bytes32) {
        return
            keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("EURC"), keccak256("2"), vm.getChainId(), address(token)));
    }

    function _sign(uint256 key, address holder, uint256 value, uint256 nonce, uint256 deadline)
        private
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(token.PERMIT_TYPEHASH(), holder, spender, value, nonce, deadline));
        return vm.sign(key, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
    }
}

/// @notice The USDC double works from etched code at Arc's USDC address, as the local chain script uses it.
contract MockArcUSDCTest is Test {
    MockArcUSDC private constant USDC = MockArcUSDC(0x3600000000000000000000000000000000000000);

    function setUp() public {
        vm.etch(address(USDC), type(MockArcUSDC).runtimeCode);
    }

    function test_metadataWorksWithoutConstructor() public pure {
        assertEq(USDC.name(), "USDC");
        assertEq(USDC.symbol(), "USDC");
        assertEq(USDC.decimals(), 6);
    }

    function test_balanceOfMirrorsNativeBalance() public {
        address holder = makeAddr("holder");
        vm.deal(holder, 12.345_678 ether + 999);
        assertEq(USDC.balanceOf(holder), 12_345_678);
    }

    function test_blocklistLivesInEtchedStorage() public {
        address holder = makeAddr("holder");
        assertFalse(USDC.isBlacklisted(holder));
        USDC.setBlacklisted(holder, true);
        assertTrue(USDC.isBlacklisted(holder));
        USDC.setBlacklisted(holder, false);
        assertFalse(USDC.isBlacklisted(holder));
    }

    function test_transfersRevertWithGuidance() public {
        vm.expectRevert(bytes("MockArcUSDC: send USDC as native value on a local chain"));
        USDC.transfer(address(1), 1);
        vm.expectRevert(bytes("MockArcUSDC: send USDC as native value on a local chain"));
        USDC.transferFrom(address(1), address(2), 1);
    }
}
