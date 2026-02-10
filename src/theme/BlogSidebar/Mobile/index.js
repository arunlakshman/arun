import React, {memo} from 'react';
import {
  useVisibleBlogSidebarItems,
  BlogSidebarItemList,
} from '@docusaurus/plugin-content-blog/client';
import {NavbarSecondaryMenuFiller} from '@docusaurus/theme-common';
import BlogSidebarContent from '@theme/BlogSidebar/Content';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

const ListComponent = ({items}) => {
  return (
    <BlogSidebarItemList
      items={items}
      ulClassName="menu__list"
      liClassName="menu__list-item"
      linkClassName="menu__link"
      linkActiveClassName="menu__link--active"
    />
  );
};

function BlogSidebarMobileSecondaryMenu({sidebar}) {
  const items = useVisibleBlogSidebarItems(sidebar.items);
  return (
    <>
      {/* Custom navigation links */}
      <ul className="menu__list">
        <li className="menu__list-item">
          <Link to="/about" className="menu__link">
            About
          </Link>
        </li>
      </ul>
      <hr className={styles.divider} />
      <BlogSidebarContent
        items={items}
        ListComponent={ListComponent}
        yearGroupHeadingClassName={styles.yearGroupHeading}
      />
    </>
  );
}

function BlogSidebarMobile(props) {
  return (
    <NavbarSecondaryMenuFiller
      component={BlogSidebarMobileSecondaryMenu}
      props={props}
    />
  );
}
export default memo(BlogSidebarMobile);
